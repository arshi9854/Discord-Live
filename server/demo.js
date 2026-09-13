const examples = [
  ['Maya', 'So happy you found your way here. There’s always room for one more at our little table. 🌷'],
  ['Jordan', 'Sending a pocketful of sunshine from my side of the world. ☀️'],
  ['Sam', 'Here’s to new friends, happy accidents, and a very good slice of cake. 🍰'],
  ['Maya', 'A tiny reminder: you make this place a little lovelier just by being in it.'],
  ['Jordan', 'Can’t wait for our next catch-up. Bringing the snacks this time!'],
  ['Sam', 'These are sample notes. Connect your Discord channel for messages from your own people.'],
];

export function startDemo(store, intervalMs = 12_000) {
  let sequence = 0;
  const publish = (time = Date.now()) => {
    const [name, content] = examples[sequence % examples.length];
    store.upsert({
      id: `demo-${++sequence}`, author: { name, avatarUrl: null }, content,
      createdAt: new Date(time).toISOString(), editedAt: null, attachments: [], url: null,
    });
  };
  for (let i = 3; i > 0; i--) publish(Date.now() - i * 30_000);
  store.setStatus({ connected: true, channelName: 'demo-channel', guildName: 'Demo workspace', error: null });
  const timer = setInterval(publish, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
