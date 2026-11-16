// A Python script that sends a run's requests again. It holds the body of the run's requests as the Lab
// sent it (lib/request-frame.ts), puts each document where the marks are, and posts it to the same address,
// using only Python's standard library. The template marks every value that comes from the study as
// {{PLACEHOLDER}}; fillScript inserts the values.
import {isGemini4,type Provider} from '../providers';
import {wireKeys,isExplanationField,RATIONALE_KEY,type AnswerSettings} from '../answer-types';
import type {RequestFrame} from '../request-frame';
import {requestParts} from './export-data';

// A Python string literal. Text with line breaks becomes a triple-quoted literal that reads as the text does.
export function pyString(text:string):string{
 if(!text.includes('\n'))return JSON.stringify(text);
 // Escaped: backslashes; carriage returns and other control characters (Python would read a raw carriage
 // return in the source as a line break); and quotes where they would end the literal.
 const body=text.replace(/\\/g,'\\\\').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,c=>c==='\r'?'\\r':'\\x'+c.charCodeAt(0).toString(16).padStart(2,'0')).replace(/"(?=""|"*$)/g,'\\"');
 return '"""'+body+'"""';
}
// A JSON value as a Python literal (True, False, None), set out over lines.
export function pyLiteral(value:unknown,indent=0):string{
 const pad='    '.repeat(indent),inner='    '.repeat(indent+1);
 if(value===null||value===undefined)return 'None';
 if(value===true)return 'True';
 if(value===false)return 'False';
 if(typeof value==='number')return Number.isFinite(value)?String(value):'None';
 if(typeof value==='string')return pyString(value);
 if(Array.isArray(value)){
  if(!value.length)return '[]';
  if(value.every(item=>typeof item!=='object'||item===null)&&!value.some(item=>typeof item==='string'&&item.includes('\n')))return '['+value.map(item=>pyLiteral(item)).join(', ')+']';
  return '[\n'+value.map(item=>inner+pyLiteral(item,indent+1)).join(',\n')+',\n'+pad+']';
 }
 const entries=Object.entries(value as Record<string,unknown>);
 if(!entries.length)return '{}';
 return '{\n'+entries.map(([key,item])=>inner+JSON.stringify(key)+': '+pyLiteral(item,indent+1)).join(',\n')+',\n'+pad+'}';
}
// Text for a line of the script's opening docstring, where a backslash, three quotes, or a line break would break it.
const docLine=(text:string)=>text.replace(/\\/g,'\\\\').replace(/"""/g,"'''").replace(/\s*[\r\n]+\s*/g,' ');

export const SCRIPT_TEMPLATE=String.raw`"""
LLM annotation script.

Study:  {{STUDY_NAME}}
Run:    {{RUN_DESCRIPTION}}

This script sends the requests of the run above again: the same model, prompt,
answer format, and request settings, to the same address. It holds the body of
the run's requests as sent in the original run, with marks where each
document goes.
Values marked with {{...}} in annotate_template.py are inserted from the study.
It needs Python 3.9 or later and no other packages.{{SCRIPT_NOTE}}

Usage
-----
    export {{API_KEY_ENV}}=...            # your own API key
    python annotate.py corpus.csv
    python annotate.py corpus.csv --dry-run   # print the first request, send nothing

corpus.csv has one document per row, with these columns: doc_id; text (the
document's text) or file (the path of a PDF, from the folder of corpus.csv);
and source (the name each request gives for the document; without it, the
PDF's own name or the doc_id). Where the prompt has placeholders that were
filled in for each document, the corpus also needs the columns named under
INSERTS below.

Outputs: results.csv (one row per request: a document's annotations are
numbered in the column replicate, and are not combined here) and log.jsonl
(every request and the provider's whole response; the script never writes
your API key). Each run
starts from the first row and overwrites --out; log.jsonl is appended to. To
continue an interrupted run, pass a CSV of the remaining documents and a new
--out.

Note: hosted models can change or be retired, and generation is not fully
deterministic, so sending the requests again may not reproduce every answer.
The original run's results and logs are the authoritative record.
"""

import argparse
import base64
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

# ===================== STUDY CONFIGURATION (inserted) =====================

PROVIDER = {{PROVIDER}}  # "openai", "anthropic", "gemini", or "openrouter"

# Where the run's requests were sent.
URL = {{URL}}

# The environment variable that holds your API key.
API_KEY_ENV = {{API_KEY_ENV_NAME}}

# The body of the run's requests, as sent in the original run: the model, the
# prompt, the answer format, and every request setting. Three
# marks stand for the document: <<DOCUMENT_FILENAME>>, <<DOCUMENT_TEXT>>, and
# <<FILE_BASE64>> (the data of a PDF). None: the run sent only PDFs.
REQUEST = {{REQUEST}}

# The body of the requests that carried a whole PDF (None: the run sent none).
REQUEST_PDF = {{REQUEST_PDF}}

# The placeholders of the prompt that were filled in for each document, and the
# column of the corpus that holds a document's value for each (for {{id}}, its
# doc_id). In the bodies above a mark stands for each placeholder, such
# as <<INSERT:meta.year>>. An empty dictionary: the prompt has none. None for a
# column: the study no longer has that column, and nothing is filled in.
INSERTS = {{INSERTS}}

# The answer fields, in their order. An empty list: the answer is one score or
# category.
FIELDS = {{FIELDS}}

# The key of each answer field in the answer format, in the order of FIELDS (an
# empty list: the key "score"). None: the earlier format, which has the fields
# under "answers" as f0, f1, ..., and the explanation under "explanation".
KEYS = {{KEYS}}

# The key of the explanation in the answer format (None: none was asked for, or
# the earlier format).
RATIONALE = {{RATIONALE}}

# The values the answer format allows for a field (a field not listed: any text).
ALLOWED = {{ALLOWED}}

# True: the run asked for plain text, and the whole reply is the answer.
PLAIN_TEXT = {{PLAIN_TEXT}}

# How many times the run annotated each document (its annotations per text).
REPLICATES = {{REPLICATES}}

# Seconds to wait for a reply, as in the original run.
TIMEOUT = {{TIMEOUT}}

# ==================== END OF STUDY CONFIGURATION ==========================

MARK = re.compile("<<DOCUMENT_FILENAME>>|<<DOCUMENT_TEXT>>|<<FILE_BASE64>>|<<INSERT:(?:id|meta[.][^<>]{1,60})>>")
SHORT_CODE = re.compile(r"^[\w .:/@+()-]{1,200}$")
FENCE = re.compile("^" + chr(96) * 3 + r"(?:json)?\s*([\s\S]*?)\s*" + chr(96) * 3 + "$")


def fill(value, document):
    """A copy of a request body with one document in place of the marks."""
    if isinstance(value, str):
        return MARK.sub(lambda m: document.get(m.group(0), m.group(0)), value)
    if isinstance(value, list):
        return [fill(item, document) for item in value]
    if isinstance(value, dict):
        return {key: fill(item, document) for key, item in value.items()}
    return value


def build_request(row, args, folder, number):
    """(doc_id, request body, the PDF's data or "") for one row of the corpus; the body is None without a document."""
    doc_id = row.get(args.id_column) or str(number)
    inserts = {"<<INSERT:%s>>" % name: (row.get(column) or "") if column else "" for name, column in INSERTS.items()}
    path = (row.get(args.file_column) or "").strip()
    if path and REQUEST_PDF is not None:
        with open(os.path.join(folder, path), "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        name = row.get(args.name_column) or os.path.basename(path)
        return doc_id, fill(REQUEST_PDF, {**inserts, "<<DOCUMENT_FILENAME>>": name, "<<DOCUMENT_TEXT>>": "", "<<FILE_BASE64>>": data}), data
    text = row.get(args.text_column) or ""
    if not text.strip() or REQUEST is None:
        return doc_id, None, ""
    name = row.get(args.name_column) or doc_id
    return doc_id, fill(REQUEST, {**inserts, "<<DOCUMENT_FILENAME>>": name, "<<DOCUMENT_TEXT>>": text, "<<FILE_BASE64>>": ""}), ""


def without_data(value, data):
    """The request as it is logged and printed: a PDF's data is replaced by a note of its length."""
    if not data:
        return value
    if isinstance(value, str):
        return value.replace(data, "[PDF data, %d base64 characters]" % len(data))
    if isinstance(value, list):
        return [without_data(item, data) for item in value]
    if isinstance(value, dict):
        return {key: without_data(item, data) for key, item in value.items()}
    return value


def headers(key):
    common = {"Content-Type": "application/json", "User-Agent": "text-annotation-lab-script/1"}
    if PROVIDER == "anthropic":
        return {"x-api-key": key, "anthropic-version": "2023-06-01", **common}
    if PROVIDER == "gemini":
        return {"x-goog-api-key": key, **common}
    return {"Authorization": "Bearer " + key, **common}


def send(url, body, key):
    """Send one request; return (HTTP status, the provider's response read as JSON, or None)."""
    # Written as in the original run: no spaces, and every character as it is.
    data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    for attempt in range(5):
        request = urllib.request.Request(url, data=data, headers=headers(key), method="POST")
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                status, raw, wait = response.status, response.read(), None
        except urllib.error.HTTPError as error:
            status, raw, wait = error.code, error.read(), error.headers.get("retry-after")
        # Too many requests, or a busy server: wait and send again, up to four times. A request that
        # timed out is not sent again (it may have been answered, and would be paid for twice).
        if (status == 429 or status >= 500) and attempt < 4:
            try:
                delay = float(wait)
            except (TypeError, ValueError):
                delay = 2 ** attempt
            time.sleep(min(60, max(0, delay)))
            continue
        try:
            return status, json.loads(raw.decode("utf-8"))
        except ValueError:
            return status, None


def read_reply(out):
    """What a response holds, read as in the original run: (text, model, stop reason, usage, response id, complete)."""
    if PROVIDER == "openai":
        parts = [c for item in out.get("output") or [] for c in item.get("content") or []]
        refused = any(c.get("type") == "refusal" for c in parts)
        text = "".join(c.get("text") or "" for c in parts if c.get("type") == "output_text")
        reason = (out.get("incomplete_details") or {}).get("reason")
        stop = "refusal" if refused else ": ".join(x for x in (out.get("status"), reason) if isinstance(x, str) and x)
        return text, out.get("model"), stop, out.get("usage"), out.get("id"), out.get("status") == "completed" and not refused
    if PROVIDER == "anthropic":
        text = "".join(b.get("text") or "" for b in out.get("content") or [] if b.get("type") == "text")
        return text, out.get("model"), out.get("stop_reason") or "", out.get("usage"), out.get("id"), out.get("stop_reason") == "end_turn"
    if PROVIDER == "gemini":
        candidate = (out.get("candidates") or [{}])[0]
        blocked = (out.get("promptFeedback") or {}).get("blockReason")
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p["text"] for p in parts if not p.get("thought") and isinstance(p.get("text"), str))
        return text, out.get("modelVersion"), blocked or candidate.get("finishReason") or "", out.get("usageMetadata"), out.get("responseId"), not blocked and candidate.get("finishReason") == "STOP"
    choice = (out.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    refused = bool(message.get("refusal"))
    text = message.get("content") if isinstance(message.get("content"), str) else ""
    model = " via ".join(x for x in (out.get("model"), out.get("provider")) if isinstance(x, str) and x)
    return text, model, "refusal" if refused else choice.get("finish_reason") or "", out.get("usage"), out.get("id"), not refused and choice.get("finish_reason") == "stop"


def token_counts(usage):
    """(input tokens, output tokens) as the provider counts them; input includes tokens read from or written to a cache."""
    usage = usage or {}
    if PROVIDER == "gemini":
        return usage.get("promptTokenCount"), (usage.get("candidatesTokenCount") or 0) + (usage.get("thoughtsTokenCount") or 0)
    if PROVIDER == "openrouter":
        return usage.get("prompt_tokens"), usage.get("completion_tokens")
    if PROVIDER == "anthropic":
        return sum(usage.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")), usage.get("output_tokens")
    return usage.get("input_tokens"), usage.get("output_tokens")


def reject_constant(name):
    raise ValueError(name + " is not valid JSON")


def read_json(text):
    """Read JSON strictly: NaN and Infinity, which Python would accept, are not valid JSON."""
    return json.loads(text, parse_constant=reject_constant)


def parse_answer(text):
    """The answers of one reply, checked as in the original run: (values by column, problem or "")."""
    if PLAIN_TEXT:
        reply = text.strip()
        if not reply:
            return {}, "The reply is empty"
        # A reply that holds JSON among other words cannot be split into columns, so it counts as failed.
        if re.search(r'\{\s*"', reply):
            fenced = FENCE.match(reply)
            try:
                readable = isinstance(read_json(fenced.group(1) if fenced else reply), dict)
            except ValueError:
                readable = False
            if not readable:
                return {"response": reply}, "The reply contains JSON that could not be read"
        return {"response": reply}, ""
    try:
        result = read_json(text)
    except ValueError:
        return {}, "The reply was not valid JSON"
    if KEYS is not None:
        # Each field under its own key and type.
        if not isinstance(result, dict):
            return {}, "The reply did not have the answer format"
        explanation = result.get(RATIONALE) if RATIONALE else ""
        if not isinstance(explanation, str):
            return {}, "The reply is missing its explanation"
        values = {}
        for name, key in zip(FIELDS or ["score"], KEYS or ["score"]):
            value = as_text(result.get(key))
            if value is None:
                return {}, "The reply is missing a named answer field"
            values[name] = value
    else:
        if not isinstance(result, dict) or not isinstance(result.get("score"), str) or not isinstance(result.get("explanation"), str):
            return {}, "The reply did not have the answer format"
        explanation = result["explanation"]
        if FIELDS:
            answers = result.get("answers")
            if not isinstance(answers, dict) or any(not isinstance(answers.get("f%d" % i), str) for i in range(len(FIELDS))):
                return {}, "The reply is missing a named answer field"
            values = {name: answers["f%d" % i] for i, name in enumerate(FIELDS)}
        else:
            values = {"score": result["score"]}
    for name, value in values.items():
        if not value.strip():
            return {}, "The answer for " + name + " is missing"
        allowed = ALLOWED.get(name)
        if allowed and value.strip().lower() not in [a.lower() for a in allowed]:
            return {}, "The answer for " + name + " is not one of the allowed values"
    if "explanation" not in [name.lower() for name in values]:
        values["explanation"] = explanation
    return values, ""


def as_text(value):
    """An answer as the original results keep it: text as it is, a number as 3 or
    2.5, true and false as yes and no. None: not an answer."""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return str(int(value)) if value.is_integer() and abs(value) < 1e21 else repr(value)
    return value if isinstance(value, str) else None


def short_code(out):
    """A provider's short error code (never its message, which can repeat a document or a credential)."""
    error = out.get("error") if isinstance(out, dict) else None
    for value in (error.get("type"), error.get("code"), error.get("status")) if isinstance(error, dict) else ():
        if isinstance(value, str) and SHORT_CODE.match(value):
            return value
    return ""


def main():
    # Print UTF-8 whatever the console's code page (on Windows, output sent to a file would otherwise fail).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("corpus", help="CSV file with one document per row")
    ap.add_argument("--id-column", default="doc_id")
    ap.add_argument("--text-column", default="text")
    ap.add_argument("--file-column", default="file", help="column with the path of a PDF to send as a file")
    ap.add_argument("--name-column", default="source", help="column with the name each request gives for the document")
    ap.add_argument("--out", default="results.csv")
    ap.add_argument("--log", default="log.jsonl")
    ap.add_argument("--limit", type=int, default=None, help="only annotate the first N documents")
    ap.add_argument("--dry-run", action="store_true", help="print the first request and exit")
    ap.add_argument("--base-url", default=None, help="send to another server at the same path (a proxy or a test server)")
    args = ap.parse_args()

    # Long documents: Python's csv module refuses fields over 131,072 characters by default.
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    with open(args.corpus, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        sys.exit("No rows found in " + args.corpus)
    if args.text_column not in rows[0] and args.file_column not in rows[0]:
        sys.exit("Neither column '%s' nor column '%s' was found. Columns: %s" % (args.text_column, args.file_column, ", ".join(rows[0].keys())))
    absent = [column for column in INSERTS.values() if column and column not in rows[0]]
    if absent:
        sys.exit("The prompt inserts values from columns that were not found: %s. Columns: %s" % (", ".join(absent), ", ".join(rows[0].keys())))
    folder = os.path.dirname(os.path.abspath(args.corpus))
    url = URL if not args.base_url else args.base_url.rstrip("/") + "/" + URL.split("/", 3)[3]

    if args.dry_run:
        doc_id, body, data = build_request(rows[0], args, folder, 1)
        if body is None:
            sys.exit("The first row has no document to send.")
        print("POST " + url)
        print(json.dumps(without_data(body, data), indent=2, ensure_ascii=False))
        return

    key = os.environ.get(API_KEY_ENV)
    if not key:
        sys.exit("Set the environment variable " + API_KEY_ENV + " to your API key.")
    answers = ["response"] if PLAIN_TEXT else (FIELDS or ["score"])
    explained = not PLAIN_TEXT and "explanation" not in [name.lower() for name in answers]
    own = ["doc_id", "replicate", "status", "error", "model_reported", "stop_reason", "input_tokens", "output_tokens", "latency_s", "completed_at", "response_id"]
    # As in the original results: a field named like one of these columns is written as answer_<name>.
    column_of = {name: "answer_" + name if name in own else name for name in answers}
    if explained:
        column_of["explanation"] = "explanation"
    columns = [*own[:3], *column_of.values(), *own[3:]]
    now = lambda: dt.datetime.now(dt.timezone.utc).isoformat()
    # With a byte-order mark, so Excel reads letters such as æ, ø, and å correctly.
    with open(args.out, "w", newline="", encoding="utf-8-sig") as out_file, open(args.log, "a", encoding="utf-8") as log:
        writer = csv.DictWriter(out_file, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for number, row in enumerate(rows, 1):
            doc_id, body, data = build_request(row, args, folder, number)
            for replicate in range(1, REPLICATES + 1):
                record = {"doc_id": doc_id, "replicate": replicate}
                started = time.time()
                if body is None:
                    record.update(status="error", error="No document to send (an empty text, or a kind of document the run did not send)")
                else:
                    try:
                        status, out = send(url, body, key)
                        record["completed_at"] = now()
                        entry = {"doc_id": doc_id, "replicate": replicate, "completed_at": record["completed_at"], "http_status": status, "request": without_data(body, data), "response": out}
                        if status != 200 or not isinstance(out, dict) or (PROVIDER == "openrouter" and out.get("error")):
                            code = short_code(out)
                            record.update(status="error", error="The provider answered with an error (HTTP %d%s)" % (status, ": " + code if code else ""))
                        else:
                            text, model, stop, usage, response_id, complete = read_reply(out)
                            # As in the original run: a cut-off, refused, empty, or unreadable answer counts as failed.
                            values, problem = parse_answer(text) if complete else ({}, "Incomplete answer (stop reason: %s)" % (stop or "none"))
                            # As in the original results: a failed answer's values are left blank (the answer is in
                            # the log), except a plain-text reply.
                            if problem:
                                values = {"response": values["response"]} if PLAIN_TEXT and "response" in values else {}
                            tokens_in, tokens_out = token_counts(usage)
                            record.update({column_of.get(name, name): value for name, value in values.items()})
                            record.update(status="error" if problem else "ok", error=problem, model_reported=model, stop_reason=stop,
                                          input_tokens=tokens_in, output_tokens=tokens_out, response_id=response_id)
                        log.write(json.dumps(entry, ensure_ascii=False) + "\n")
                    except Exception as e:  # keep going; failed requests are recorded
                        record.update(status="error", error=type(e).__name__ + ": " + str(e), completed_at=now())
                        log.write(json.dumps({"doc_id": doc_id, "replicate": replicate, "completed_at": record["completed_at"], "request": without_data(body, data),
                                              "error": type(e).__name__ + ": " + str(e)}, ensure_ascii=False) + "\n")
                record["latency_s"] = round(time.time() - started, 2)
                writer.writerow(record)
                out_file.flush()
                log.flush()
                print("[%d/%d] %s%s" % (number, len(rows), doc_id, " (annotation %d of %d)" % (replicate, REPLICATES) if REPLICATES > 1 else ""), file=sys.stderr)


if __name__ == "__main__":
    main()
`;

const KEY_NAMES:Record<Provider,string>={openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY',openrouter:'OPENROUTER_API_KEY'};
export const keyVariable=(provider:Provider)=>KEY_NAMES[provider];
// The values the answer format allows, by field (`score` for the single score or category). keys: the fields'
// keys in the named format (absent: the earlier format). A whole number there is allowed as the Lab keeps it (3),
// and a scale given by its ends (Google's schema) allows each whole number between them.
function allowedValues(frame:RequestFrame,fields:string[],keys?:string[]):Record<string,string[]>{
 const schema=requestParts(frame).schema,out:Record<string,string[]>={};
 const list=(name:string,spec:any)=>{
  if(Array.isArray(spec?.enum)&&spec.enum.every((value:unknown)=>typeof value==='string')&&spec.enum.some((value:string)=>value!==''))out[name]=spec.enum;
  else if(Array.isArray(spec?.enum)&&spec.enum.length&&spec.enum.every((value:unknown)=>Number.isInteger(value)))out[name]=spec.enum.map(String);
  else if(String(spec?.type).toLowerCase()==='integer'&&Number.isInteger(spec?.minimum)&&Number.isInteger(spec?.maximum)&&spec.maximum>=spec.minimum&&spec.maximum-spec.minimum<=1000)out[name]=Array.from({length:spec.maximum-spec.minimum+1},(_,i)=>String(spec.minimum+i));
 };
 if(!schema)return out;
 if(keys)fields.length?fields.forEach((name,i)=>list(name,schema.properties?.[keys[i]])):list('score',schema.properties?.score);
 else if(fields.length)fields.forEach((name,i)=>list(name,schema.properties?.answers?.properties?.['f'+i]));else list('score',schema.properties?.score);
 return out;
}
// text, pdf: the run's request for a text and for a PDF sent as a file (lib/request-frame.ts); at least one.
// repeats: the run's annotations per text (absent: one). inserts: for each placeholder of the prompt that was
// filled in, the corpus column that holds its values (null: the study no longer has the column).
// settings: the run's answer settings (for the named format).
export type ScriptInput={studyName:string;runDescription:string;provider:Provider;text?:RequestFrame;pdf?:RequestFrame;fields:string[];plain:boolean;settings?:AnswerSettings;repeats?:number;note?:string;inserts?:[string,string|null][]};
export function scriptValues(input:ScriptInput):Record<string,string>{
 const frame=(input.text||input.pdf)!,model=requestParts(frame).model,named=!input.plain&&input.settings?.named===true,keys=named?wireKeys(input.fields,input.settings):undefined;
 return {
  STUDY_NAME:docLine(input.studyName),RUN_DESCRIPTION:docLine(input.runDescription),
  SCRIPT_NOTE:input.note?'\n\n'+input.note.split('\n').map(docLine).join('\n'):'',
  API_KEY_ENV:keyVariable(input.provider),API_KEY_ENV_NAME:JSON.stringify(keyVariable(input.provider)),
  PROVIDER:JSON.stringify(input.provider),URL:JSON.stringify(frame.url),
  REQUEST:input.text?pyLiteral(JSON.parse(input.text.body)):'None',REQUEST_PDF:input.pdf?pyLiteral(JSON.parse(input.pdf.body)):'None',
  INSERTS:pyLiteral(Object.fromEntries(input.inserts||[])),
  FIELDS:pyLiteral(input.plain?[]:input.fields),KEYS:keys?pyLiteral(keys):'None',RATIONALE:named&&input.settings?.rationale!==false&&!input.fields.some(isExplanationField)?JSON.stringify(RATIONALE_KEY):'None',ALLOWED:pyLiteral(input.plain?{}:allowedValues(frame,input.fields,keys)),PLAIN_TEXT:input.plain?'True':'False',REPLICATES:String(Number.isInteger(input.repeats)&&input.repeats!>=1&&input.repeats!<=10?input.repeats:1),
  TIMEOUT:String(input.provider==='gemini'&&isGemini4(model)?900:180),
 };
}
// Only the placeholders of the configuration are replaced; text inserted for one is never read again, so a
// prompt that itself holds {{WORDS}} stays as it is.
export function fillScript(template:string,values:Record<string,string>):string{
 return template.replace(/\{\{([A-Z_]+)\}\}/g,(whole,key:string)=>Object.hasOwn(values,key)?values[key]:whole);
}
export const REQUIREMENTS='# annotate.py needs no packages: it uses only Python’s standard library (Python 3.9 or later).\n';
