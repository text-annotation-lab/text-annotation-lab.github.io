import {TabsContent} from '@/components/ui/tabs';

export function GetStarted() {
  return <TabsContent value="get-started" className="reading-panel panel">
    <p className="eyebrow">YOUR FIRST ANNOTATION</p>
    <h2 id="get-started" tabIndex={-1}>Get started</h2>
    <p>Watch this short introduction, then follow the steps below to set up your account, try a small pilot, and save your results.</p>

    <figure className="intro-video">
      <video controls preload="metadata" playsInline poster="/video/text-annotation-lab-walkthrough.jpg" aria-label="Introduction to the Text Annotation Lab (3.5 minutes)">
        <source src="/video/text-annotation-lab-walkthrough.mp4" type="video/mp4" />
        <a href="/video/text-annotation-lab-walkthrough.mp4">Download the introduction video (MP4)</a>
      </video>
      <figcaption>Introduction to the lab · 3½ minutes</figcaption>
    </figure>

    <h2 className="mt-8">Set up your API key</h2>
    <p>An API key connects the lab to the account that pays for your annotations. If you already have a key, including one from your instructor, go straight to step 3.</p>
    <ol className="teaching-tips">
      <li><h3>Set up your account</h3>
        <p>The steps here use <a href="https://platform.openai.com/" target="_blank" rel="noreferrer">OpenAI Platform</a> as an example. You can also use <a href="https://platform.claude.com/" target="_blank" rel="noreferrer">Anthropic</a>, <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google</a>, or <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
        <p>Sign in or create an account. If OpenAI asks you to create an “organization,” you can be its only member. This is where your projects and billing are kept.</p>
      </li>
      <li><h3>Add a small amount of credit</h3>
        <p>For OpenAI, open <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">API billing</a>. If you need credit, $5 is a reasonable amount to start with. Check the final charge before paying and leave automatic replenishment off.</p>
      </li>
      <li><h3>Enter your key in the lab</h3>
        <p>Use the key your instructor gave you or create one in your provider account. In OpenAI, select your project and open <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a>. In <a href="#workspace">Workspace</a>, select the provider that issued the key and paste it into the API key field.</p>
        <p>Keep your key private. The lab keeps it only while the page is open, so you’ll need to enter it again if you reload.</p>
      </li>
    </ol>

    <h2 className="mt-8">Run your first annotation</h2>
    <ol className="teaching-tips">
      <li><h3>Prepare your annotation</h3>
        <p>In <a href="#workspace">Workspace</a>, enter your annotation prompt and choose a model. GPT-6 Luna is an economical starting point if you’re using OpenAI. Leave reasoning effort at its default and upload three to five varied documents for your first trial.</p>
      </li>
      <li><h3>Run a small pilot and check the results</h3>
        <p>Read the first text and decide how you would score or categorize it. Choose <strong>Annotate next</strong>, then select its row to see the model’s answer. Did it follow your instructions? Does its explanation make sense when you check it against the text? Repeat with the rest of your sample.</p>
        <p>Revise the prompt if needed. To keep the pilot, save a version in <strong>Studies</strong>. Then use <strong>Clear results</strong> to keep the documents ready for another trial. Each new annotation can add to your spending.</p>
      </li>
      <li><h3>Annotate the full corpus and save your results</h3>
        <p>Once you’re satisfied with the pilot, use the same final prompt, model, and reasoning settings for every text. Add the remaining documents, open <strong>Costs</strong> for an estimate, and choose <strong>Run all</strong>.</p>
        <p>Download the results as an Excel workbook for analysis. To reopen the study on another computer, choose <strong>Download study backup</strong> in <strong>Studies</strong>.</p>
      </li>
    </ol>

    <h3 id="data-handling" tabIndex={-1}>Your texts and provider data policies</h3>
    <p>Running an annotation sends your prompt and document to the service you select. If you use OpenRouter, the model provider also receives them. Before submitting personal or confidential material, check your institution’s requirements and the data policy for <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI</a>, <a href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noreferrer">Anthropic</a>, <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Google</a>, or <a href="https://openrouter.ai/docs/guides/privacy/data-collection" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
    <h3>Having trouble?</h3>
    <p>Read the message beside the affected text. If a request was interrupted, check your usage before retrying because the request may already have been charged. If you need help, give your instructor the error message and model name. Keep your key private.</p>
    <p>Read the <a href="#prompting-tips">Prompting tips</a>, follow the <a href="#study-example">Study example</a>, or explore the <a href="#corpus-example">Corpus examples</a>.</p>
  </TabsContent>;
}
