// Eyes comparison: describe the same images with several vision models using vision.js's prompt, and report
// the description, time and resident size. For deciding whether one model can be brain and eyes.
//   node bakeoff/brain/eyes.js --models huihui_ai/qwen3-vl-abliterated:8b-instruct,huihui_ai/qwen3.5-abliterated:9b --images a.jpg,b.jpg [--keep-loaded]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MODEL as PRODUCTION } from '../../orchestrator/brain.js';
import { chat, loadOptions, ps, thinkFlag, unload } from '../../lib/ollama.js';

const { values: args } = parseArgs({ options: { models: { type: 'string' }, images: { type: 'string' }, 'keep-loaded': { type: 'boolean', default: false } } });
const models = args.models.split(',').map(s => s.trim()).filter(Boolean);
const images = args.images.split(',').map(s => s.trim()).filter(Boolean);
const PROMPT = process.env.PEAK_VISION_PROMPT ?? 'Describe this image in one short sentence, mentioning any people and what they are doing.';
const VISION_MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const gb = n => (n / 2 ** 30).toFixed(1);

for (const model of models) {
  const think = await thinkFlag(model);
  console.log(`\n## ${model}`);
  for (const [i, file] of images.entries()) {
    const image = readFileSync(file).toString('base64');
    const { message, stats } = await chat({ model, think, options: { ...loadOptions(), num_predict: 80 },
      messages: [{ role: 'user', content: PROMPT, images: [image] }] });
    const loaded = (await ps()).find(m => m.name === model);
    console.log(`- ${file.split('/').pop()}: ${(stats.totalMs / 1000).toFixed(1)}s (load ${stats.loadMs}ms, ${stats.evalTokens} tok)${i === 0 && loaded ? `, resident ${gb(loaded.size)} GB${loaded.size_vram < loaded.size ? ' (offloaded)' : ''}` : ''}`);
    console.log(`  "${message.content.trim().replace(/\s+/g, ' ')}"`);
  }
  if (!args['keep-loaded'] && model !== PRODUCTION && model !== VISION_MODEL) await unload(model);
}
