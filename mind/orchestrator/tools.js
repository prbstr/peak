// Tool surface the model drives (via the JSON reply shape in index.js). Keep it tiny: gesture, say, look_at, snapshot.
export const tools = [
  {
    name: 'gesture',
    description: 'Play a named gesture on a body. Names come from node/gestures.yaml.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['wave', 'point', 'nod', 'shrug', 'rest', 'look_left', 'look_right'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'say',
    description: 'Speak a short line through the body\'s speaker.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'look_at',
    description: 'Turn the head toward a point in the camera frame. x,y in 0..1.',
    input_schema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
  },
];

export async function runTool(client, node, name, input) {
  const topic = `peak/${node}/cmd`;
  switch (name) {
    case 'gesture':
      client.publish(topic, JSON.stringify({ gesture: input.name }));
      return { ok: true };
    case 'say':
      client.publish(topic, JSON.stringify({ say: input.text }));
      return { ok: true };
    case 'look_at': {
      // head pan: x=0 → 150°, x=1 → 30° (mirror so the mech looks where the thing is)
      const deg = Math.round(150 - input.x * 120);
      client.publish(topic, JSON.stringify({ servo: 'head', deg, ms: 400 }));
      return { ok: true, deg };
    }
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}
