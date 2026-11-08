import {TabsContent} from '@/components/ui/tabs';

export function About(){
 return <TabsContent value="about" className="reading-panel panel">
  <p className="eyebrow">BACKGROUND AND CREDITS</p>
  <h2 id="about" tabIndex={-1}>About Text Annotation Lab</h2>
  <p>Text Annotation Lab is a teaching resource for AI-assisted text annotation and content analysis. It brings together an annotation workspace, example corpora, teaching guidance, and methodological resources.</p>
  <p>The project is based in the Department of English at Aarhus University and is associated with the American Studies Center Aarhus (ASCA). It was developed for students in the department, with examples grounded in English and American Studies. Students, teachers, and researchers elsewhere are welcome to use it wherever they find it useful.</p>
  <p>The site is free to use. To run annotations, enter an API key from your instructor or your own provider account. Charges and usage limits apply to the account behind that key.</p>
   <p>For questions or feedback, contact <a href="mailto:jkc@cc.au.dk">Jens Kjeldgaard-Christiansen</a>.</p>
  <article>
   <h3>People</h3>
   <p><strong><a href="https://pure.au.dk/portal/en/persons/jkc@cc.au.dk/" target="_blank" rel="noreferrer">Jens Kjeldgaard-Christiansen</a></strong><br/>Creator and developer · Department of English, Aarhus University</p>
   <p>Jens teaches English and American Studies at Aarhus University. His research connects cultural studies and psychology, examining popular media, moral and emotional responses, and political communication.</p>
   <p><strong><a href="https://edgardubourg.fr/" target="_blank" rel="noreferrer">Edgar Dubourg</a></strong><br/>Methodological advisor · Paris School of AI, PSL</p>
   <p>Edgar is an AI Research Fellow at the Paris School of AI, PSL, whose research combines cognitive science with AI-based methods to study fiction and culture.</p>
  </article>
  <article>
   <h3>How to cite Text Annotation Lab</h3>
   <p>If you use Text Annotation Lab in research or describe it in a publication, the suggested Chicago author-date citation is:</p>
   <p className="about-citation">Kjeldgaard-Christiansen, Jens. 2026. <em>Text Annotation Lab</em>. <a href="https://asca.au.dk/annotation-lab" target="_blank" rel="noreferrer">https://asca.au.dk/annotation-lab</a>.</p>
   <p className="reading-meta">Because the site evolves, include your access date where appropriate. Citation is appreciated and is not a condition of use.</p>
  </article>
 </TabsContent>;
}
