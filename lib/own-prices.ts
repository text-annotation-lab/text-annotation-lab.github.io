// Research mode: your own price for a model, used only for the cost estimate before a run. The Lab's prices are
// list prices and can go out of date, and a model outside the Lab's lists has none. Own prices are kept in this
// browser's local storage, per provider and model, and are never part of a study, a backup, or an export.
import {useSyncExternalStore} from 'react';
import type {OwnPrice,Provider} from './cost-estimate/pricing';
export type OwnPrices=Record<string,OwnPrice>;
// USD per million tokens.
export const MAX_OWN_PRICE=100000;
const STORE='text-annotation-lab:own-prices',LIMIT=200,NAME=/^(?:openai|gemini|anthropic|openrouter):[^\s]{1,200}$/;
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=MAX_OWN_PRICE;
const name=(provider:Provider,model:string)=>provider+':'+model;

// What is read from storage is checked entry by entry; anything else is left out. The latest LIMIT prices are kept.
export function cleanOwnPrices(value:unknown):OwnPrices{
 const prices:OwnPrices={};
 if(!value||typeof value!=='object'||Array.isArray(value))return prices;
 for(const [key,price] of Object.entries(value as Record<string,unknown>).slice(-LIMIT)){
  const {input,output}=(price&&typeof price==='object'?price:{}) as {input?:unknown;output?:unknown};
  if(NAME.test(key)&&valid(input)&&valid(output))prices[key]={input,output};
 }
 return prices;
}
const stored=():OwnPrices|undefined=>{try{return cleanOwnPrices(JSON.parse(window.localStorage.getItem(STORE)??'{}'));}catch{return undefined;}};
const NONE:OwnPrices={};
let prices:OwnPrices|undefined,kept=true;
const listeners=new Set<()=>void>();
const current=():OwnPrices=>prices??=stored()??{};

export function ownPrice(provider:Provider,model:string,all:OwnPrices=current()):OwnPrice|undefined{return all[name(provider,model)];}
// A price replaces the Lab's for this model; null goes back to the Lab's. Anything that is not a price changes
// nothing. Where storage is unavailable, the change lasts until the page is closed. Storage is read again
// first, so that a price typed in another tab stays.
export function setOwnPrice(provider:Provider,model:string,price:OwnPrice|null){
 if(price&&!(valid(price.input)&&valid(price.output)))return;
 const {[name(provider,model)]:previous,...rest}=(kept?stored():undefined)??current();
 prices=price?cleanOwnPrices({...rest,[name(provider,model)]:{input:price.input,output:price.output}}):rest;
 try{window.localStorage.setItem(STORE,JSON.stringify(prices));kept=true;}catch{kept=false;}
 for(const listener of listeners)listener();
}
function watch(listener:()=>void){
 // Another tab of this browser changed the prices.
 const changed=(event:StorageEvent)=>{if(event.key===STORE||event.key===null){prices=undefined;listener();}};
 listeners.add(listener);window.addEventListener('storage',changed);
 return()=>{listeners.delete(listener);window.removeEventListener('storage',changed);};
}
export function useOwnPrices():OwnPrices{return useSyncExternalStore(watch,current,()=>NONE);}
