// Research mode: the scale of the scores in plain-text replies that are JSON (for example "race": -2), set for
// the study. It is never sent to the model: it says how the scores are compared. A value of a reply whose
// numbers mostly lie on it is compared on it as on an ordinal field's allowed values, so the agreement figures
// use every point of the scale and a number off it is left out and reported. Without it, the scale is the range
// of the scores the model gave.
export type ScoreScale={min:number;max:number};

// A usable scale: two whole numbers, the lowest first, at most 100 apart.
export function cleanScoreScale(value:unknown):ScoreScale|undefined{
 if(!value||typeof value!=='object')return undefined;
 const {min,max}=value as {min?:unknown;max?:unknown};
 return Number.isInteger(min)&&Number.isInteger(max)&&(min as number)<(max as number)&&(max as number)-(min as number)<=100?{min:min as number,max:max as number}:undefined;
}
export const scalePoints=(scale:ScoreScale)=>Array.from({length:scale.max-scale.min+1},(_,i)=>String(scale.min+i));
export const scaleText=(scale:ScoreScale)=>`${scale.min} to ${scale.max}`;

// A yes / no in numbers ("flag": 1): every number 0 or 1, or most of them with at most one in a hundred (at least
// one) near them (a stray 2, −1, or 0.5), besides codes far off them (a 9 for "can't tell": at most two different
// codes, and at most one number in ten). Decimals between 0 and 1 (0.15, 0.73) are a proportion, not a flag.
export const farFromZeroOne=(x:number)=>x<-3||x>4;
export function zeroOne(numbers:number[]):boolean{
 if(!numbers.length)return false;
 let flags=0,near=0;const far:number[]=[];
 for(const x of numbers){if(x===0||x===1)flags++;else if(farFromZeroOne(x))far.push(x);else near++;}
 const codes=new Set(far).size<=2&&far.length<=numbers.length/10;
 return flags===numbers.length||(flags*2>numbers.length&&near<=Math.max(1,numbers.length/100)&&codes);
}
// Whether a value's numbers are read on the scale: most of them lie on it, and they are not a yes / no in numbers
// (only 0 and 1, besides at most two codes far off the scale, such as 9 for "can't tell"), which keeps its own
// range as without the scale.
export function onScale(numbers:number[],scale:ScoreScale):boolean{
 if(!numbers.length)return false;
 const off=(x:number)=>x<scale.min||x>scale.max;
 const codes=numbers.filter(x=>x!==0&&x!==1);
 const flag=codes.every(x=>farFromZeroOne(x)&&off(x))&&new Set(codes).size<=2&&codes.length<=numbers.length/10;
 return !flag&&numbers.filter(x=>!off(x)).length*2>=numbers.length;
}
