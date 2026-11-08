# Agreed review follow-up — November 5, 2026

## User decisions

- Restore the introduction exactly: “Set your annotation prompt, upload documents, run the analysis, and download your results.” The replacement was introduced in commit e98895d on November 2. Do not rewrite this central copy during cleanup.
- Remove the outline on programmatically focused headings; keep keyboard indicators on interactive controls.
- Consolidate setup explanations, remove the character counter and repetitive lines, improve small text and figure-link names, and reduce startup work.
- Fix the AU embed and obsolete AU page content. Do not add the Lab to ASCA navigation or For Students yet.
- Do not add sample studies, coursework/exam guidance, or human judgment fields. Preserve Further resources, Model knowledge, and the Billboard corpus.

## Local implementation

The requested app changes were published as version 139 on November 5, 2026. The original hero sentence is restored. Saved prompts and answer fields remain beside the prompt. Converter libraries are loaded on demand, and returning-study initialization reads only metadata before the workspace restores its documents.

`docs/au-embed.html` is the replacement saved in TYPO3 content element 95046 after publishing the matching app readiness message in `Home`. It retains functionality-cookie gating, supplies an explanatory/direct-link fallback, and disables only identified AU template regions. Messages contain no study data and validate both origin and source. Live testing identified the required CookieScript `data-cookiescript="accepted"` marker; this is now included. The iframe stays transparent and inert until ready, and a persistent AU cookie preferences button opens the existing consent dialog.

## Validation

- All 29 existing test scripts passed; provider calls were mocked.
- New `tests/startup.cjs` verifies metadata-only initialization and preservation of documents/results.
- New `tests/au-embed.cjs` verifies readiness messages, origin/source filtering, consent gating, fallback reset, and cookie-control preservation.
- TypeScript and the production build passed after the changes.
- The initial local browser preview could not start because of EACCES. After publication, the direct app and AU embed were visually reviewed. The embedded app loaded successfully in the in-app browser, including the exact restored introduction.
- Declining cookies left the iframe without a source and displayed the fallback. Restoring functionality consent loaded the app and removed the fallback/inert state. The AU cookie dialog remained usable above the embed.
- Keyboard navigation moved from the direct link to AU cookie information and then to AU cookie preferences, with visible focus indicators; Enter opened the consent dialog. Covered AU template regions had `inert` attributes. A full keyboard check inside the cross-origin app was limited by a browser-control timeout.
- The Chrome session did not finish loading the embedded app during testing; its fallback remained available. The same published page loaded successfully in the in-app browser. The cause of the Chrome-session failure is unresolved; do not describe universal browser compatibility as verified. No live loading-speed benchmark was taken.

## Publication and AU completion

Publishing access was checked first and worked in the resumed session. Source commit `23ed42e91b95445535dab42d8f76ff60fe6ef256` was pushed, packaged, and published to the existing public project `appgprj_6aa188c94ff88191b75dbddc48fb54e3`. Version 139 is live at https://text-annotation-lab.jenskc1987.chatgpt.site. Version ID: `appgprj_6aa188c94ff88191b75dbddc48fb54e3~appgver_e4c455fc0c608191b83b30985456f5b1`. Deployment `appgdep_6aecea05968081918dbb46cf15839cab` succeeded at 20:42:03 UTC on November 5, 2026. No new Site was created.

On https://asca.au.dk/annotation-lab (TYPO3 page 14089), the browser title and meta description now name “Text Annotation Lab.” Content element 95046 contains the updated embed. Records 94867, 94870, 94873, 94876, 94879, and 94882 were hidden in TYPO3, preserving recovery; their content IDs are absent from the public HTML. ASCA navigation and For Students were not changed.

The final embed corrections and regression-test updates are local follow-up files; they were applied directly to AU after app version 139 was deployed. They do not change the hosted app bundle. Publication proof is saved in the parent workspace as `au-annotation-lab-published-2026-11-05.png`. Remaining verification limits are the Chrome-session loading failure and the full embedded-app keyboard check noted above.
