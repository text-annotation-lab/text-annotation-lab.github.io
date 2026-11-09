"use client";
import {TabsContent} from '@/components/ui/tabs';

import {CorpusChooser} from './corpus-chooser';
import tips from '@/lib/teaching-tips.json';

export function TeachingPanels(){return <>
  <TabsContent value="resources" className="reading-panel panel">
    <p className="eyebrow">FURTHER READING</p><h2 id="further-resources" tabIndex={-1}>Further resources</h2>
    <p>For those who want to explore the methods behind AI-assisted text annotation in more depth.</p>
    <article><h3><a href="https://doi.org/10.6092/issn.1971-8853/19461" target="_blank" rel="noreferrer">Best Practices for Text Annotation with Large Language Models ↗</a></h3><p className="reading-meta">Petter Törnberg · 2024</p><p>Practical methodological guidance on choosing models, designing prompts, testing stability, and validating annotations. Start here when planning your study.</p></article>
    <article><h3><a href="https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2024.1365508/full" target="_blank" rel="noreferrer">A step-by-step method for cultural annotation by LLMs ↗</a></h3><p className="reading-meta">Edgar Dubourg, Valentin Thouzeau, &amp; Nicolas Baumard · 2024</p><p>A structured method for using language models to annotate cultural data, with a practical workflow for researchers studying cultural phenomena.</p></article>
    <article><h3><a href="https://doi.org/10.1098/rsos.251766" target="_blank" rel="noreferrer">Generating units of cultural analysis with large language models: methods and validation for scalable cross-cultural research ↗</a></h3><p className="reading-meta">Kristen L. Syme, Nikos Motos, &amp; Caitlyn D. Placek · 2026 · Royal Society Open Science</p><p>A step-by-step framework for turning ethnographic texts into theory-driven annotations, illustrated with ritual fasting across 56 societies. Shows how to define constructs, refine prompts, compare model outputs with human coding, and investigate disagreements.</p></article>
    <article><h3><a href="https://www.edgardubourg.fr/pdfs/dubourg-thouzeau-2026-double-edge.pdf" target="_blank" rel="noreferrer">The Double Edge of AI Annotation in Cultural Sciences ↗</a></h3><p className="reading-meta">Edgar Dubourg &amp; Valentin Thouzeau · 2026 · Preprint</p><p>Examines how annotation errors affect research conclusions, distinguishing random noise from systematic bias. Offers guidance on the annotation quality and human validation needed for a particular study.</p></article>
    <article><h3><a href="https://doi.org/10.1073/pnas.2305016120" target="_blank" rel="noreferrer">ChatGPT Outperforms Crowd-Workers for Text-Annotation Tasks ↗</a></h3><p className="reading-meta">Fabrizio Gilardi, Meysam Alizadeh, &amp; Maël Kubli · 2023</p><p>An empirical comparison of model and human annotations for several classification tasks. A useful introduction to the method’s potential; its findings do not establish accuracy for your own corpus or categories.</p></article>
    <article><h3><a href="https://arxiv.org/abs/2604.09638" target="_blank" rel="noreferrer">A Methodological Guide on Using Large Language Models for Reproducible Text Annotation in the Social Sciences and Humanities with Python and R ↗</a></h3><p className="reading-meta">Qixiang Fang, Javier Garcia Bernardo, &amp; Erik-Jan van Kesteren · 2026 · Preprint</p><p>A practical guide to reproducible annotation workflows in Python and R. Explains how to evaluate prompts without overfitting, account for annotation error in statistical analysis, and document model settings and results, with worked code examples.</p></article>
  </TabsContent>
  <TabsContent value="corpus" className="reading-panel panel">
    <p className="eyebrow">CORPUS EXAMPLES</p><h2 id="corpus-example" tabIndex={-1}>Corpus examples</h2>
    <aside className="center-notice"><p>Explore American history, society, and culture with these teaching collections from the <a href="https://asca.au.dk/" target="_blank" rel="noreferrer">American Studies Center Aarhus</a>.</p></aside>
    <p>These collections offer different questions and text types for an annotation study. Each download contains individual text files and source information.</p>
    <CorpusChooser/>
    <h3 className="corpus-details-heading">Collection notes &amp; downloads</h3>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-inaugural" tabIndex={-1}>US presidential inaugural addresses</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>60 speech files spanning 1789–2025, from George Washington’s first inaugural address to Donald Trump’s 2025 address. The collection represents 40 presidents, with a separate plain-text file for each address.</p>
      <p>Filenames identify the year and president. The included metadata list records the president, inaugural address number, year, date, location, and source collection for each file.</p>
      <p>Use the corpus to explore changes in presidential rhetoric: national identity, religion, optimism, freedom, or America’s role in the world.</p>
      <a className="download-link" href="/teaching/inaugural-corpus.zip" download>Download inaugural corpus (.zip)</a>
      <p>Unzip the download, then upload the speech files you want to study in the <a href="#workspace">Workspace</a> tab. Keep the metadata list for reference.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Source collections are identified in the included manifest.csv. Check the original source when citing a speech.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-debates" tabIndex={-1}>US presidential debates, 1960–2024</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>37 general-election presidential debates, from Kennedy and Nixon in 1960 to Harris and Trump in 2024. The collection includes whole debates, candidate-specific files, and individual answers with the preceding turn for context.</p>
      <p>Choose one level for your study: <strong>texts/debates</strong> contains 37 full transcripts; <strong>texts/candidates</strong> contains 77 candidate files; <strong>texts/turns_sample</strong> provides a balanced starter sample of 290 turns; and <strong>texts/turns_all</strong> contains 1,874 turns of at least 50 words. These are overlapping views of the same debates, so do not combine the folders as independent observations.</p>
      <p>Use the corpus to study attacks on opponents, answers and evasions, policy priorities, or national identity. For turn files, tell the model to annotate only the <strong>TURN</strong> section and use the <strong>PRECEDING TURN</strong> as context. Debate formats, moderators’ questions, and transcript editing can affect comparisons; the README and metadata explain these differences.</p>
      <a className="download-link" href="/teaching/presidential_debates_corpus.zip" download>Download presidential debates (.zip)</a>
      <p>Unzip the download, then start with selected files from <strong>texts/turns_sample</strong> in the <a href="#workspace">Workspace</a> tab. Keep the README and metadata workbook for sampling, candidate details, source links, and verification notes.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Transcripts come from the American Presidency Project. Sources, preparation, and usage notes are included in the README and metadata workbook.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-obituaries" tabIndex={-1}>Paired obituaries, 1880–1959</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>200 American newspaper obituaries form 100 woman–man pairs. Each pair comes from the same newspaper, with publication dates as close together as the available sources allowed.</p>
      <p>The <strong>texts_clean</strong> folder contains the files to annotate; <strong>texts_raw_ocr</strong> contains the same obituaries before light OCR cleanup. The metadata workbook records pair IDs, dates, newspapers, word counts, source scans, and quality notes.</p>
      <p>Use the corpus to compare how obituaries describe work, family, character, and achievement. Check important passages against the linked scans: OCR errors and changes in obituary style can affect the results.</p>
      <a className="download-link" href="/teaching/obituary_pairs_corpus.zip" download>Download paired obituaries (.zip)</a>
      <p>Unzip the download, then upload a sample from <strong>texts_clean</strong> in the <a href="#workspace">Workspace</a> tab. Keep the metadata workbook for pairing and source checks.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Texts derive from Chronicling America via the American Stories dataset; source scans are linked in the workbook.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-scouts" tabIndex={-1}>Boy Scouts and Camp Fire Girls, 1912–1919</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>120 chapters from 24 novels for young readers: five chapters each from 12 Boy Scouts books and 12 Camp Fire Girls books. The selection balances chapters and partly matches publishers across the two groups.</p>
      <p>The <strong>texts/boys</strong> and <strong>texts/girls</strong> folders contain one plain-text file per chapter. The metadata workbook records each book, publisher, year, chapter position, word count, and source link.</p>
      <p>Use the corpus to compare who solves problems, faces danger, does domestic work, or speaks about what girls and boys should be. The fiction also contains period stereotypes and offensive language; read these as part of its historical setting.</p>
      <a className="download-link" href="/teaching/scouts_campfire_corpus.zip" download>Download Scouts and Camp Fire corpus (.zip)</a>
      <p>Unzip the download, then upload a balanced selection of chapter files in the <a href="#workspace">Workspace</a> tab. Keep the metadata workbook to compare similar chapter positions and publishers.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Texts derive from Project Gutenberg editions, with source links in the workbook.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-wpa" tabIndex={-1}>WPA slave narratives: women and men, 1936–1938</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>100 interviews with formerly enslaved people, balanced between 50 women and 50 men and matched by state. The interviews were recorded about 70 years after emancipation.</p>
      <p>The <strong>texts/women</strong> and <strong>texts/men</strong> folders contain the files to annotate. The metadata workbook records each narrator, state, source volume, word count, and source link. The separate <strong>excluded</strong> folder holds four interviews that were replaced and are not part of the study sample.</p>
      <p>Use the corpus to study memories of work, family, freedom, and the aftermath of slavery. Consider how interviewers, transcription, and childhood memories shaped the accounts. The texts contain racial slurs and descriptions of violence and sexual exploitation.</p>
      <a className="download-link" href="/teaching/wpa_narratives_women_men.zip" download>Download WPA narratives (.zip)</a>
      <p>Unzip the download, then upload selected files from <strong>texts</strong> in the <a href="#workspace">Workspace</a> tab. Keep the metadata workbook for the state matching and source references.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Texts derive from the Library of Congress WPA collection as transcribed by Project Gutenberg.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-campaign" tabIndex={-1}>Campaign speeches: Obama 2008 and Trump 2016</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>117 general-election campaign speeches: 55 prepared texts from Barack Obama, 41 prepared texts from Donald Trump, and 21 transcripts of Trump speaking as delivered.</p>
      <p>The three <strong>texts</strong> subfolders separate speaker, year, and text type. The metadata workbook records the date, occasion, word count, source link, and notes on whether each speech was prepared or delivered.</p>
      <p>Use the corpus to compare how the campaigns frame crisis, national identity, opponents, or policy. Compare prepared texts with prepared texts; use the delivered transcripts as a separate study of script and performance. Repeated stump speeches are not independent observations.</p>
      <a className="download-link" href="/teaching/campaign_speeches_2008_2016.zip" download>Download campaign speeches (.zip)</a>
      <p>Unzip the download, then upload a selected set of speech files in the <a href="#workspace">Workspace</a> tab. Keep the metadata workbook to distinguish prepared texts from delivered transcripts.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Speeches come from the American Presidency Project; each source page is linked in the workbook.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-westerns" tabIndex={-1}>Dime-novel westerns, 1870–1875</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>24 complete Beadle and Adams novels set in the American West. Each novel is roughly 26,000–35,000 words, making this a substantial corpus for a more focused study.</p>
      <p>The <strong>texts</strong> folder contains one plain-text file per novel. The metadata workbook records the author and printed byline, series, year, setting, Native nations depicted, and source link.</p>
      <p>Use the corpus to examine how the novels name and portray Native characters, assign voices, and turn historical conflicts into entertainment. The texts contain racist language, caricatures, and scenes of violence; account for these in your study design.</p>
      <a className="download-link" href="/teaching/dime_westerns_1870s.zip" download>Download dime-novel westerns (.zip)</a>
      <p>Unzip the download, then upload one or a few novel files in the <a href="#workspace">Workspace</a> tab. Start with a small pilot: long texts may take more time and incur higher API charges.</p>
      <p className="reading-meta">Collection provided by Jens Kjeldgaard-Christiansen. Texts derive from Project Gutenberg editions, with source links in the workbook.</p>
    </div></details>
    <details className="corpus-detail" data-corpus><summary><h3 id="corpus-billboard" tabIndex={-1}>Billboard hit-song lyrics, 1960–2016</h3><span>Notes &amp; download</span></summary><div className="corpus-detail-body">
      <p>4,547 artist–title–year records from the Billboard Year-End Hot 100, with one plain-text file per record. Songs that appear in multiple chart years remain separate records; the year identifies the year-end chart, not necessarily the release date.</p>
      <p>The <strong>texts</strong> folder organizes song files by year. Excel and CSV versions contain the same records, and the package includes an English README, a filename manifest, and the complete exclusion log.</p>
      <p>Use the corpus to explore changing themes of love, status, conflict, or aspiration in popular music. These are charting hits, not a representative sample of all music. Missing lyrics vary over time, some texts are multilingual, and transcription errors or wrong song matches may remain after targeted filtering. Check a sample before drawing historical comparisons.</p>
      <a className="download-link" href="/teaching/billboard_corpus.zip" download>Download Billboard lyrics corpus (.zip)</a>
      <p>Unzip the download, then upload selected TXT files from <strong>texts</strong> in the <a href="#workspace">Workspace</a> tab. Start with a small pilot. Keep the spreadsheets and documentation for reference; use one format for your study.</p>
      <p className="reading-meta">Prepared by Jens Kjeldgaard-Christiansen from Mikkel Freltoft Krogsholm’s <a href="https://cran.r-project.org/web/packages/billboard/index.html" target="_blank" rel="noreferrer">billboard R package</a>, version 0.1.0. Sources, filtering decisions, and usage notes are documented in the README.</p>
    </div></details>
  </TabsContent>
  <TabsContent value="tips" className="reading-panel panel">
    <p className="eyebrow">STUDENT GUIDE</p><h2 id="prompting-tips" tabIndex={-1}>10 tips for prompting text annotation</h2>
    <p>Your prompt works like a small codebook: it tells the model what to look for and how to record its judgment.</p>
    <ol className="teaching-tips">{tips.map((tip,i)=>{const end=tip.indexOf('. ');return <li key={i}><strong>{tip.slice(0,end+1)}</strong>{' '}{tip.slice(end+2)}</li>})}</ol>

    <p>Remember: AI annotations are measurements to be evaluated. A longer prompt is not necessarily a better prompt; aim for instructions that are clear, specific, balanced, and reproducible.</p>
    <p>For more guidance on designing and validating your study, see <a href="#further-resources">Further resources</a>.</p>
    <a className="download-link" href="/teaching/annotation-tips.docx" download>Download the tips (.docx)</a>
    <p className="reading-meta">Jens Kjeldgaard-Christiansen · Department of English, Aarhus University</p>
  </TabsContent>
</>}
