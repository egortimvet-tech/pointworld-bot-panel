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
  res.json({ ok: true, uptime: Math.round(process.uptime()), online: farm.onlineCount(), queue: farm.queue.length, serverUp: farm._serverUp, stagger: !!farm._stagger })
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
}, 600000)

process.on('unhandledRejection', (err) => console.error('[unhandled]', err))
process.on('uncaughtException', (err) => console.error('[uncaught]', err))
