import { openSync, readSync } from 'node:fs';
import { parseDff } from './src/renderware/parsers/binary/dff';
const fd = openSync('static/models/gta3-pf.img', 'r');
const head = Buffer.alloc(8); readSync(fd, head, 0, 8, 0);
const count = head.readUInt32LE(4);
const dir = Buffer.alloc(count * 32); readSync(fd, dir, 0, count * 32, 8);
function read(name: string): ArrayBuffer | null {
  for (let i=0;i<count;i++){const b=i*32;let e=b+8;while(e<b+32&&dir[e]!==0)e++;
    if(dir.toString('latin1',b+8,e).toLowerCase()===name.toLowerCase()){const sec=dir.readUInt16LE(b+4)||dir.readUInt16LE(b+6);
      const buf=Buffer.alloc(sec*2048);readSync(fd,buf,0,sec*2048,dir.readUInt32LE(b)*2048);
      return buf.buffer.slice(buf.byteOffset,buf.byteOffset+sec*2048) as ArrayBuffer;}}
  return null;
}
for (const m of ['compfukhouse3','vegashse5']) {  // 3589, and a guess for 17699 (fixed below)
  const ab = read(m+'.dff'); if(!ab){console.log(m,'ABSENT'); continue;}
  const c = parseDff(ab);
  console.log(`\n${m}.dff geoms=${c.geometries.length}`);
  c.geometries.forEach((g,gi)=>g.materials.forEach((mm,mi)=>console.log(`  [${gi}.${mi}] ${mm.texture?.name}`)));
}
