import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
async function walk(dir) {
 const files=[];
 for (const item of await fs.readdir(dir,{withFileTypes:true})) {
  const full=path.join(dir,item.name);
  if(item.isDirectory()) files.push(...await walk(full));
  else if(item.isFile()&&item.name.endsWith(".js")&&item.name!=="loader.js"&&item.name!=="helpers.js") files.push(full);
 }
 return files;
}
export async function loadCommands() {
 const commands=new Map();
 for(const file of (await walk(ROOT)).sort()) {
  const mod=await import(pathToFileURL(file).href);
  const c=mod.default;
  if(!c?.data||typeof c.execute!=="function") throw new Error("Invalid command module: "+file);
  if(commands.has(c.data.name)) throw new Error("Duplicate slash command name: "+c.data.name);
  commands.set(c.data.name,c);
 }
 return commands;
}