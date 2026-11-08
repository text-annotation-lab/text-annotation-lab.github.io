// Optional additions only: the original prose remains in study-example.json.
// Set this to false to remove all six notes without editing the study.
export const CLOSER_LOOK_NOTES_ENABLED = true;

const notes = [
  {
    id: 'defining-complexity',
    before: '<h3>Running the annotation</h3>',
    title: 'Defining complexity',
    extension: '<strong>What should “complexity” mean here?</strong> The prompt combines vocabulary, sentence structure, and register in one score. These features need not move together: a speech can use familiar words in long, intricate sentences.</p><p>This raises a question of <strong>validity</strong>: does the score capture the feature we want to study? An old-fashioned word may be hard for today’s readers without making a sentence structurally complex. Decide whether the study concerns readers’ overall experience, sentence structure, or another defined feature, and make that choice clear in the prompt.',
    resources: 'On defining what to measure: Dubourg et al. (2024) and Syme et al. (2026) in <a href="#further-resources">Further resources</a>.',
  },
  {
    id: 'giving-scores-meaning',
    before: '<h3>Running the annotation</h3>',
    title: 'Giving the scores meaning',
    extension: '<strong>What would distinguish a 4 from a 5?</strong> The example defines only the ends of its 1–7 scale. To develop it, describe each score using the same features throughout. Explain what changes in vocabulary, sentence structure, or register would justify moving up a point.</p><p>Try the descriptions on a few speeches: can you justify choosing one score over its neighbor? The numbers show an order; they do not establish that every one-point difference represents an equal change in complexity.',
    resources: 'On defining rating scales: Dubourg et al. (2024) and Syme et al. (2026) in <a href="#further-resources">Further resources</a>.',
  },
  {
    id: 'developing-prompt',
    before: '<h3>Interpreting the results</h3>',
    title: 'Developing the prompt',
    extension: '<strong>How can you develop and test an annotation prompt?</strong> Start with a draft, such as the complexity-rating prompt in this study, and try it on a few varied speeches, including early and recent ones. Rate them yourself using the same instructions before looking at the model’s answers. Where a judgment seems poorly supported, check whether the prompt leaves something unclear—for example, how to distinguish a long list from a sentence with several layers of connected ideas.</p><p>If you revise the prompt to address a problem, test the new version on speeches you did not use to develop it. Improvement on familiar examples may not carry over. Judge revisions by their fit to your question and the textual evidence, rather than whether they produce the trend you expected. Save the final prompt and settings with your results.',
    resources: 'On prompt development and evaluation: Fang et al.’s methodological guide in <a href="#further-resources">Further resources</a>.',
  },
  {
    id: 'analysing-results',
    before: '<p>What jumps out at you?',
    title: 'Analyzing results',
    extension: '<strong>Would the pattern survive a reasonable change in the analysis?</strong> <strong>Robustness</strong> means that the main finding holds up under such changes. Here, one simple check is whether the downward trend depends heavily on a particular speech.</p><p>Identify a speech that sits far from the trend, then compare the graph with and without it. Does the broad pattern remain, or change substantially? Report what you find. This is a check on the finding, not a reason to delete an inconvenient observation. A stable pattern can still reflect mistakes shared across the annotations.',
    resources: 'On checking findings and annotation errors: Fang et al. and Dubourg &amp; Thouzeau (2026) in <a href="#further-resources">Further resources</a>.',
  },
  {
    id: 'interpreting-findings',
    before: '<h3>Checking the results</h3>',
    title: 'Interpreting findings',
    extension: '<strong>What does the pattern show, and what might explain it?</strong> The scores summarize the model’s judgments of these speeches. They do not establish why language changed. FDR’s health and the wartime setting might help explain his fourth address’s style; assessing those explanations requires close reading and historical evidence.</p><p>Keep the claim within the evidence: a pattern in inaugural addresses need not hold for campaign speeches or everyday English. Nor does FDR receiving the same score as Trump make their styles identical. Similar ratings can reflect different combinations of vocabulary, sentence structure, and register.',
    resources: 'Compare <a href="https://avalon.law.yale.edu/20th_century/froos3.asp" target="_blank" rel="noreferrer">FDR’s third inaugural address (1941) ↗</a> and <a href="https://avalon.law.yale.edu/20th_century/froos4.asp" target="_blank" rel="noreferrer">fourth inaugural address (1945) ↗</a>.',
  },
  {
    id: 'checking-annotations',
    before: '<p>That’s it for this little illustration.',
    title: 'Checking annotations',
    extension: '<strong>Are the ratings consistent and supported by the texts?</strong> <strong>Reliability</strong> concerns consistency. Try rerunning a varied sample with unchanged settings. Ask independent readers to rate the same speeches using the same instructions, without seeing the model’s scores.</p><p>Compare the ratings and investigate disagreements against the texts. Neither readers nor the model are automatically right. Agreement alone does not establish <strong>validity</strong>: both could share a misunderstanding of what complexity should mean. Also verify any supporting quotations.',
    reflection: 'Just as a scale measures weight or a thermometer measures temperature, AI can serve as a measurement tool for a defined feature of a text. Statistical comparisons with independent human ratings help assess whether it works well enough for the study.',
    resources: 'On human comparison and reviewing disagreements: Syme et al. (2026) and the other methodological papers in <a href="#further-resources">Further resources</a>.',
  },
];

export function withCloserLookNotes(originalHtml: string): string {
  if (!CLOSER_LOOK_NOTES_ENABLED) return originalHtml;
  return notes.reduce((html, note) => {
    const position = html.indexOf(note.before);
    // If the original changes, leave its prose intact instead of guessing a location.
    if (position < 0) return html;
    const addition = `<details class="study-closer-look" data-study-note="${note.id}"><summary>A closer look <span>· ${note.title}</span></summary><div class="study-closer-look-body"><p>${note.extension}</p>${note.reflection ? `<p>${note.reflection}</p>` : ''}<p class="study-closer-look-resources"><strong>Explore further:</strong> ${note.resources}</p></div></details>\n`;
    return html.slice(0, position) + addition + html.slice(position);
  }, originalHtml);
}
