/** Native root/executor helper. No Git, check execution, lifecycle change or approval. */
import {existsSync, lstatSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {readAuthorized} from '../src/evidence/extract.js';
import {digest} from '../src/evidence/github.js';
import {createReviewPacket, verifyReviewPacket} from '../src/evidence/review.js';
import {evaluateFilePath, readToolDenyPatterns} from '../src/security.js';

const [operation,...args] = process.argv.slice(2);
const allowed = new Set(['--workspace','--current','--current-sha256','--previous','--previous-sha256','--output',
  ...(operation==='prepare'?['--milestone','--risks','--risks-sha256']:['--packet','--packet-sha256'])]);
const options = new Map<string,string>();
try {
  if(!['prepare','verify'].includes(operation) || args.length%2)throw new Error('usage');
  for(let i=0;i<args.length;i+=2) {
    if(!allowed.has(args[i])||options.has(args[i])||!args[i+1])throw new Error('usage');options.set(args[i],args[i+1]);
  }
  for(const name of ['--previous','--risks'])if(options.has(name)!==options.has(name+'-sha256'))throw new Error('paired input required');
  const required = (name:string) => {const value=options.get(name);if(!value)throw new Error('missing option');return value;};
  const root = realpathSync(required('--workspace'));
  const inside = (path:string) => {const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
  const authorize = (path:string) => {
    try {
      const supplied=resolve(path),canonical=realpathSync(path),deny=readToolDenyPatterns('Read',root);
      return inside(supplied)&&inside(canonical)&&[path,supplied,canonical,relative(root,canonical)]
        .every(p=>!evaluateFilePath(p,deny,process.platform==='win32',root).denied);
    }catch{return false;}
  };
  // Native caller restrictions/sandbox still apply. Do not accept a workspace
  // merely because a child packet names it; root supplies this option itself.
  const load = (name:string) => {
    const path=resolve(required(name)),expected=required(name+'-sha256');
    if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('invalid digest');
    const read=readAuthorized(path,authorize,128*1024*1024);
    if(read.partial||digest(read.data)!==expected)throw new Error('input digest or authorization');
    return JSON.parse(read.data.toString('utf8'));
  };
  const current=load('--current'),previous=options.has('--previous')?load('--previous'):undefined;
  const value=operation==='prepare'
    ?createReviewPacket(current,required('--milestone'),options.has('--risks')?load('--risks'):[],authorize,previous)
    :verifyReviewPacket(load('--packet'),current,authorize,previous);
  const output=resolve(required('--output')),parent=realpathSync(dirname(output));
  if(extname(output)!=='.json'||!inside(parent)||!inside(output)||existsSync(output)&&lstatSync(output).isSymbolicLink())throw new Error('output scope');
  const body=JSON.stringify(value);writeFileSync(output,body,{flag:'wx',mode:0o600});
  const result=operation==='verify'?value as ReturnType<typeof verifyReviewPacket>:undefined;
  const summary={version:1,operation,decision:result?.decision??'packet-created; not verified',authority:'root acceptance required',
    candidate:current.candidate,issues:result?.issues.length??null,firstIssue:result?.issues[0]?{code:result.issues[0].code,locator:result.issues[0].locator}:null,
    delta:result?{files:result.deltaSinceLastReview.files.length,evidence:result.deltaSinceLastReview.evidence.length,unchangedEvidence:result.unchangedEvidence}:null,
    reference:{path:output,sha256:digest(body),bytes:Buffer.byteLength(body),access:'native-authorized workspace',retention:'until removed'},overflow:'full packet/result behind reference'};
  if(Buffer.byteLength(JSON.stringify(summary)+'\n')<=2048)process.stdout.write(JSON.stringify(summary)+'\n');
  else process.stdout.write(JSON.stringify({operation,decision:result?.decision??'packet-created; not verified',authority:'root acceptance required',reference:{sha256:digest(body),bytes:Buffer.byteLength(body),path:'explicit --output path'},overflow:'all identities/details in output artifact'})+'\n');
  if(result?.decision!=='ready-for-independent-review'&&operation==='verify')process.exitCode=1;
} catch {
  process.stdout.write(JSON.stringify({decision:'needs-evidence',authority:'no acceptance',reason:'invalid usage, unavailable/unauthorized input, changed digest, schema or output scope; use fresh native root observations and a new output JSON path'})+'\n');
  process.exitCode=2;
}
