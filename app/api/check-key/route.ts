import {allowedOrigin} from '@/lib/request-guards';
import {GEMINI_ENABLED} from '@/lib/providers';
import {canCheckKey} from '@/lib/workflow-safety';

const endpoints = {
 openai: 'https://api.openai.com/v1/models',
 anthropic: 'https://api.anthropic.com/v1/models?limit=1',
 gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
};

function reply(status:'accepted'|'rejected'|'unverified', httpStatus=200) {
 return Response.json({status}, {status:httpStatus, headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request) {
 if (!allowedOrigin(request)) return reply('unverified',403);
 const provider = request.headers.get('X-Lab-Provider');
 if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini') return reply('unverified',400);
 if (provider === 'gemini' && !GEMINI_ENABLED) return reply('unverified',400);
 const key = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')?.[1];
 if (!key || !canCheckKey(provider,key)) return reply('unverified',400);

 const headers = new Headers();
 if (provider === 'openai') headers.set('Authorization','Bearer '+key);
 if (provider === 'anthropic') {
  headers.set('x-api-key',key);
  headers.set('anthropic-version','2023-06-01');
  headers.set('anthropic-dangerous-direct-browser-access','true');
 }
 if (provider === 'gemini') headers.set('x-goog-api-key',key);

 try {
  const response = await fetch(endpoints[provider], {
   headers, cache:'no-store', redirect:'manual',
   signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)]),
  });
  const data = await response.json() as {
   models?:unknown; data?:unknown;
   error?:{code?:string;type?:string;details?:{reason?:string}[]};
  }|null;
  if (response.ok && Array.isArray(provider === 'gemini' ? data?.models : data?.data)) return reply('accepted');
  const error = data?.error;
  if (error?.code === 'invalid_api_key' || error?.type === 'authentication_error' ||
      (Array.isArray(error?.details) && error.details.some((detail:{reason?:string})=>detail?.reason==='API_KEY_INVALID'))) {
   return reply('rejected');
  }
 } catch { /* An unavailable provider cannot confirm the key. */ }
 return reply('unverified');
}
