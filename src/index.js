const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const { BotFarm } = require('./bots')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

const farm = new BotFarm(io)
farm.init()

app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('/ping', (req, res) => {
  const m = process.memoryUsage()
  res.json({ ok: true, uptime: Math.round(process.uptime()), online: farm.onlineCount(), real: farm.onlineRealCount(), queue: farm.queue.length, serverUp: farm._serverUp, stagger: !!farm._stagger, rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576) })
})

io.on('connection', (socket) => {
  socket.emit('bots', farm.serialize())
  socket.on('bot:accept', (d) => farm.accept(d && d.nick))
  socket.on('bot:kick', (d) => farm.kick(d && d.nick))
  socket.on('bot:walk', (d) => farm.setWalk(d && d.nick, !!(d && d.on)))
  socket.on('bot:say', (d) => {
    const t = d && typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim() : ''
    if (t) farm.say(d.nick, t)
  })
  socket.on('chat:sub', (d) => {
    if (d && d.nick) socket.emit('chat:log', { nick: d.nick, lines: farm.chatOf(d.nick) })
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log('[web] панель запущена: http://localhost:' + PORT)
})

setInterval(() => {
  const u = process.env.RENDER_EXTERNAL_URL
  if (u) fetch(u + '/ping').catch(() => {})
}, 300000)

setInterval(() => {
  const m = process.memoryUsage()
  console.log('[mem] rss=' + Math.round(m.rss / 1048576) + 'MB heap=' + Math.round(m.heapUsed / 1048576) + 'MB online=' + farm.onlineCount())
}, 300000)

process.on('unhandledRejection', (err) => console.error('[unhandled]', err))
process.on('uncaughtException', (err) => console.error('[uncaught]', err))
