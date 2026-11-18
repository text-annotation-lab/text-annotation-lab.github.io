// After a batch is checked, the notice says whether the user can leave: the closing sentence names the workspace's
// save state as it is now, and changes when a save finishes (or fails), so "you can close this page" is only shown
// once the batch and everything else is saved in this browser.
export const CLOSE_WHEN_SAVED='You can close this page once the workspace is saved.';
export type SaveState='saved'|'saving'|'failed';
const SAY:Record<SaveState,string>={
 saved:'Your workspace is saved, so you can close this page and check back later.',
 saving:'Saving the workspace… Keep this page open until this says it is saved.',
 failed:'The workspace could not be saved in this browser, so keep this page open.',
};
export function withSaveState(notice:string,state:SaveState):string{return notice.replace(CLOSE_WHEN_SAVED,SAY[state]);}
