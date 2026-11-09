"use client";
import {useEffect} from 'react';
import {ArrowDown,BookOpen,MessageSquare,FileText,Mic,Music,Landmark} from 'lucide-react';
const collections=[
 {id:'inaugural',title:'Presidential inaugural addresses',size:'60 speeches',period:'1789–2025',question:'How does the language of national identity change over time?',icon:Landmark},
 {id:'debates',title:'Presidential debates',size:'37 debates · 290-turn sample',period:'1960–2024',question:'When do candidates answer a question, and when do they evade it?',icon:MessageSquare},
 {id:'obituaries',title:'Paired obituaries',size:'200 obituaries',period:'1880–1959',question:'How are women’s and men’s achievements remembered differently?',icon:FileText},
 {id:'scouts',title:'Boy Scouts & Camp Fire Girls',size:'120 chapters',period:'1912–1919',question:'Who solves problems and takes risks in fiction for young readers?',icon:BookOpen},
 {id:'wpa',title:'WPA slave narratives',size:'100 interviews',period:'1936–1938',question:'How do formerly enslaved people recall work, family, and freedom?',icon:MessageSquare},
 {id:'campaign',title:'Obama & Trump campaign speeches',size:'117 speeches',period:'2008 & 2016',question:'How do the two campaigns portray America and their opponents?',icon:Mic},
 {id:'westerns',title:'Dime-novel westerns',size:'24 novels',period:'1870–1875',question:'How do popular westerns portray Native characters?',icon:BookOpen},
 {id:'billboard',title:'Billboard hit-song lyrics',size:'4,547 song-year records',period:'1960–2016',question:'How do themes of love, status, and conflict change in charting hits?',icon:Music},
];
function revealCorpus(){
 const target=document.getElementById(window.location.hash.slice(1));
 const details=target?.closest<HTMLDetailsElement>('details[data-corpus]');
 if(details){details.open=true;target?.focus({preventScroll:true});target?.scrollIntoView({block:'start'});}
}
export function CorpusChooser(){
 useEffect(()=>{const frame=requestAnimationFrame(revealCorpus);window.addEventListener('hashchange',revealCorpus);return()=>{cancelAnimationFrame(frame);window.removeEventListener('hashchange',revealCorpus);};},[]);
 return <nav className="corpus-chooser" aria-label="Choose a corpus"><div className="corpus-chooser-heading"><h3>Find a question that interests you</h3><p>Choose a collection to see its files, sources, and study notes.</p></div><ul>{collections.map(({id,title,size,period,question,icon:Icon})=><li key={id}><a href={'#corpus-'+id} className="corpus-card" onClick={()=>{if(window.location.hash==='#corpus-'+id)revealCorpus();}}><span className="corpus-card-top"><Icon size={21} aria-hidden="true"/><span>{period}</span></span><strong>{title}</strong><span className="corpus-card-size">{size}</span><span className="corpus-card-question">{question}</span><span className="corpus-card-link">Explore collection <ArrowDown size={15} aria-hidden="true"/></span></a></li>)}</ul></nav>;
}
