import {TabsContent} from '@/components/ui/tabs';
import study from '@/lib/study-example.json';
import {withCloserLookNotes} from '@/lib/study-closer-look';
import './study-closer-look.css';

export function StudyExample(){return <TabsContent value="study-example" className="reading-panel panel study-example"><div dangerouslySetInnerHTML={{__html:withCloserLookNotes(study.html)}}/></TabsContent>}
