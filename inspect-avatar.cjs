const fs = require('fs');
const avatar = JSON.parse(fs.readFileSync('public/avatars/ananya.gltf', 'utf8') || fs.readFileSync('public/avatars/ananya.glb', 'utf8'));
const names = avatar.nodes.map(n => n.name).filter(n => n && (n.includes('Arm') || n.includes('Spine')));
console.log(names);
