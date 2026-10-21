'use strict'

const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const { HOST, PORT, PASSWORD, MAX_ONLINE, NICKNAMES, DATA_DIR } = require('./config')

class BotFarm {
  constructor (io) {
    this.io = io
    this.entries = new Map()
    this.queue = []
    this._emitT = null
    this._saveT = null
    this._stagger = null
    this._lastConnectAt = 0
    this._probeTimer = null
    this._serverUp = null
    for (const nick of NICKNAMES) {
      this.entries.set(nick, {
        nick,
        status: 'black',
        online: false,
        connecting: false,
        spawned: false,
        queued: false,
        registered: false,
        walkOn: true,
        lastError: null,
        bot: null,
        chat: [],
        walkToken: 0,
        walkTimer: null,
        reconnectTimer: null,
        reconnectDelay: 45000,
        authSeq: 0,
        lastChatAt: 0
      })
    }
  }

  order () {
    return Array.from(this.entries.keys())
  }

  applyState (saved) {
    for (const b of (saved && saved.bots) || []) {
      const e = this.entries.get(b.nick)
      if (!e) continue
      e.status = b.status === 'wl' ? 'wl' : 'black'
      e.registered = !!b.registered
      e.walkOn = b.walkOn !== false
    }
    this.queue = this.order().filter(n => this.entries.get(n).status === 'wl')
    console.log(`[farm] bots: ${this.order().length}, whitelisted: ${this.queue.length}, max online: ${MAX_ONLINE}`)
  }

  init () {
    let saved = null
    let savedAt = 0
    try {
      const p = path.join(DATA_DIR, 'state.json')
      if (fs.existsSync(p)) {
        saved = JSON.parse(fs.readFileSync(p, 'utf8'))
        savedAt = saved.updatedAt || 0
      }
    } catch (err) {
      console.error('[state] load failed:', err.message)
    }
    this.applyState(saved)
    this.startServerProbe()
    setTimeout(() => this.maybeConnect(), 5000)
    setTimeout(() => this.restoreFromGitHub(savedAt), 2000)
  }

  ghRequest (method, url, body, accept, cb) {
    const https = require('https')
    const repo = process.env.GITHUB_REPO
    if (!process.env.GITHUB_TOKEN || !repo) { cb(new Error('no gh env')); return }
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const req = https.request({
      host: 'api.github.com',
      path: url,
      method,
      headers: {
        'User-Agent': 'pointworld-bot-panel',
        Authorization: 'token ' + process.env.GITHUB_TOKEN,
        Accept: accept || 'application/vnd.github+json',
        'Content-Length': data ? data.length : 0
      }
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => cb(null, res.statusCode, Buffer.concat(chunks)))
    })
    req.on('error', (e) => cb(e))
    if (data) req.write(data)
    req.end()
  }

  stateSnapshot () {
    return {
      updatedAt: Date.now(),
      bots: this.order().map(n => {
        const e = this.entries.get(n)
        return { nick: e.nick, status: e.status, registered: e.registered, walkOn: e.walkOn }
      })
    }
  }

  syncToGitHub () {
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) return
    let b64
    try {
      b64 = fs.readFileSync(path.join(DATA_DIR, 'state.json')).toString('base64')
    } catch (err) {
      return
    }
    this.ghRequest('GET', '/repos/' + process.env.GITHUB_REPO + '/contents/data/state.json?ref=main', null, null, (err, code, body) => {
      const patch = { message: 'state sync', content: b64, branch: 'main' }
      if (!err && code === 200) {
        try { patch.sha = JSON.parse(body.toString('utf8')).sha } catch (e2) {}
      }
      this.ghRequest('PUT', '/repos/' + process.env.GITHUB_REPO + '/contents/data/state.json', patch, null, (err2, code2) => {
        if (err2 || code2 >= 300) console.error('[state] github sync failed:', (err2 && err2.message) || code2)
        else console.log('[state] github sync ok')
      })
    })
  }

  restoreFromGitHub (localAt) {
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) return
    this.ghRequest('GET', '/repos/' + process.env.GITHUB_REPO + '/contents/data/state.json?ref=main', null, 'application/vnd.github.raw', (err, code, body) => {
      if (err || code !== 200) { console.log('[state] github restore skip (' + code + ')'); return }
      let saved = null
      try { saved = JSON.parse(body.toString('utf8')) } catch (e2) { console.error('[state] github restore parse failed'); return }
      if ((saved.updatedAt || 0) < (localAt || 0)) { console.log('[state] github state older than local — skip'); return }
      console.log('[state] restoring state from github (updatedAt ' + (saved.updatedAt) + ')')
      this.applyState(saved)
      this.emitState()
      this.maybeConnect()
    })
  }

  startServerProbe () {
    if (this._probeTimer) return
    if (!this._houseT) {
      this._houseT = setInterval(() => {
        for (const e of this.entries.values()) {
          if (e.connecting && e.tConnect && Date.now() - e.tConnect > 60000 && e.bot) {
            console.log(`[${e.nick}] connect stuck >60s, dropping`)
            e.lastError = 'подключение зависло — перезапуск'
            try { e.bot.end() } catch (err) {}
          }
        }
      }, 5000)
    }
    const probe = () => {
      this.mcStatus((r) => {
        if (r.ok) {
          this._probeMisses = 0
          this.onServerState(true)
        } else {
          this._probeMisses = (this._probeMisses || 0) + 1
          console.log('[probe] miss ' + this._probeMisses + ' (' + (r.err || 'no info') + ')')
          if (this._probeMisses >= 2) this.onServerState(false)
        }
      })
    }
    probe()
    this._probeTimer = setInterval(probe, 15000)
  }

  mcStatus (cb) {
    const net = require('net')
    const s = net.connect({ host: HOST, port: PORT, timeout: 7000 })
    let finished = false
    const finish = (up, info) => {
      if (finished) return
      finished = true
      try { s.destroy() } catch (err) {}
      cb(up ? { ok: true } : { ok: false, err: info })
    }
    s.once('connect', () => finish(true))
    s.once('error', (e) => finish(false, String(e && e.message)))
    s.once('timeout', () => finish(false, 'timeout'))
  }

  onServerState (up) {
    if (this.onlineCount() > 0 && !up) {
      console.log('[probe] bots online but probe says down — trusting bots')
      up = true
    }
    if (this._serverUp === up) return
    console.log('[probe] minecraft server ' + (up ? 'online' : 'offline'))
    this._serverUp = up
    if (up) this.recoverAll()
  }

  recoverAll () {
    for (const e of this.entries.values()) {
      if (e.status !== 'wl' || e.online || e.connecting) continue
      e.reconnectDelay = 45000
      if (e.reconnectTimer) {
        clearTimeout(e.reconnectTimer)
        e.reconnectTimer = null
      }
      if (!this.queue.includes(e.nick)) this.queue.push(e.nick)
      const sys = { ts: Date.now(), sys: true, text: 'сервер снова онлайн — быстрый перезаход' }
      e.chat.push(sys)
      if (e.chat.length > 90) e.chat.splice(0, e.chat.length - 90)
      this.io.emit('chat:msg', { nick: e.nick, ts: sys.ts, sys: true, text: sys.text })
    }
    this.maybeConnect()
  }

  onlineCount () {
    let n = 0
    for (const e of this.entries.values()) if (e.online || e.connecting) n++
    return n
  }

  serialize () {
    return this.order().map(n => {
      const e = this.entries.get(n)
      return {
        nick: e.nick,
        status: e.status,
        online: e.online,
        connecting: e.connecting,
        queued: e.queued,
        registered: e.registered,
        walkOn: e.walkOn,
        lastError: e.lastError
      }
    })
  }

  emitState () {
    if (this._emitT) return
    this._emitT = setTimeout(() => {
      this._emitT = null
      try { this.io.emit('bots', this.serialize()) } catch (err) {}
    }, 150)
  }

  save () {
    if (this._saveT) return
    this._saveT = setTimeout(() => {
      this._saveT = null
      try {
        const p = path.join(DATA_DIR, 'state.json')
        fs.writeFileSync(p, JSON.stringify(this.stateSnapshot(), null, 2))
        this.syncToGitHub()
      } catch (err) {
        console.error('[state] save failed:', err.message)
      }
    }, 1200)
  }

  chatOf (nick) {
    const e = this.entries.get(nick)
    return e ? e.chat.slice(-70) : []
  }

  accept (nick) {
    const e = this.entries.get(nick)
    if (!e) return
    e.status = 'wl'
    if (!e.online && !e.connecting && !this.queue.includes(nick)) {
      e.queued = true
      this.queue.push(nick)
    }
    this.save()
    this.emitState()
    this.maybeConnect()
  }

  kick (nick) {
    const e = this.entries.get(nick)
    if (!e) return
    e.status = 'black'
    this.queue = this.queue.filter(n => n !== nick)
    e.queued = false
    e.walkOn = false
    this.stopWalk(e)
    if (e.reconnectTimer) {
      clearTimeout(e.reconnectTimer)
      e.reconnectTimer = null
    }
    this.save()
    if (e.bot) {
      e.bot.quit('kicked from panel')
    } else {
      this.emitState()
    }
    this.maybeConnect()
  }

  setWalk (nick, on) {
    const e = this.entries.get(nick)
    if (!e) return
    e.walkOn = !!on
    if (e.walkOn && e.bot && e.online && e.spawned) this.startWalkLoop(e)
    if (!e.walkOn) this.stopWalk(e)
    this.save()
    this.emitState()
  }

  say (nick, text) {
    const e = this.entries.get(nick)
    if (!e || !e.bot) return
    const now = Date.now()
    if (now - e.lastChatAt < 700) return
    e.lastChatAt = now
    e.bot.chat(String(text).slice(0, 220))
  }

  maybeConnect () {
    this.queue = this.queue.filter(n => {
      const e = this.entries.get(n)
      return e && e.status === 'wl' && !e.online && !e.connecting
    })
    if (this._serverUp === false) {
      const since = Date.now() - (this._canaryAt || 0)
      if (since > 90000 && this.queue.length > 0 && this.onlineCount() < MAX_ONLINE) {
        this._canaryAt = Date.now()
        const nick = this.queue.shift()
        const e = this.entries.get(nick)
        if (e && !e.online && !e.connecting) {
          e.queued = false
          console.log('[canary] пробное подключение ' + nick + ' (проба: off)')
          this.connect(e)
        }
      }
      return
    }
    const since = Date.now() - (this._lastConnectAt || 0)
    if (this.onlineCount() < MAX_ONLINE && this.queue.length > 0 && since > 5500) {
      const nick = this.queue.shift()
      const e = this.entries.get(nick)
      if (e && !e.online && !e.connecting) {
        e.queued = false
        this.connect(e)
      }
    }
    this.startStagger()
  }

  startStagger () {
    if (this._stagger) return
    const spacing = Math.max(6, parseInt(process.env.JOIN_SPACING_SEC || '6', 10)) * 1000
    this._stagger = setInterval(() => {
      if (this.onlineCount() >= MAX_ONLINE || this.queue.length === 0) {
        clearInterval(this._stagger)
        this._stagger = null
        return
      }
      const nick = this.queue.shift()
      const e = this.entries.get(nick)
      if (!e || e.online || e.connecting) return
      e.queued = false
      this.connect(e)
    }, spacing)
  }

  connect (e) {
    if (e.bot || e.online || e.connecting) return
    e.connecting = true
    e.lastError = null
    this._lastConnectAt = Date.now()
    this.emitState()
    const bot = mineflayer.createBot({
      host: HOST,
      port: PORT,
      username: e.nick,
      auth: 'offline',
      hideErrors: true,
      checkTimeoutInterval: 45000,
      viewDistance: 'tiny'
    })
    e.bot = bot
    this.attach(e, bot)
  }

  sysLine (e, text) {
    const msg = { ts: Date.now(), sys: true, text }
    e.chat.push(msg)
    if (e.chat.length > 90) e.chat.splice(0, e.chat.length - 90)
    this.io.emit('chat:msg', { nick: e.nick, ts: msg.ts, sys: true, text })
  }

  attach (e, bot) {
    bot.on('login', () => {
      e.online = true
      e.connecting = false
      e.reconnectDelay = 45000
      this.sysLine(e, 'зашёл на сервер')
      const seq = ++e.authSeq
      e.regSent = 0
      e.loginSent = false
      e.authed = false
      e.promptReg = false
      const send = (cmd) => {
        if (e.authSeq !== seq || !e.bot) return
        try { bot.chat(cmd) } catch (err) {}
      }
      e.authNow = () => {
        if (e.authSeq !== seq || !e.bot || e.authed) return
        if (!e.registered) {
          if (e.regSent < 2) {
            e.regSent++
            e.registered = true
            this.save()
            this.sysLine(e, 'регистрация (/register)')
            send('/register ' + PASSWORD + ' ' + PASSWORD)
          }
        } else if (!e.loginSent) {
          e.loginSent = true
          this.sysLine(e, 'вход (/login)')
          send('/login ' + PASSWORD)
        }
      }
      setTimeout(() => e.authNow(), 700)
      setTimeout(() => {
        if (e.authSeq !== seq || !e.bot || e.authed) return
        if (!e.authed) {
          e.loginSent = false
          send('/login ' + PASSWORD)
        }
      }, 3200)
      setTimeout(() => e.authNow(), 5800)
      setTimeout(() => {
        if (e.authSeq !== seq || !e.bot || e.authed) {
          if (e.authed) return
          if (!e.bot || e.authSeq !== seq) return
          if (!e.loginSent || !e.authed) {
            console.log('[' + e.nick + '] auth fallback: unconditional /login')
            e.loginSent = true
            this.sysLine(e, 'аварийный вход (/login)')
            send('/login ' + PASSWORD)
          }
        }
      }, 10500)
      this.emitState()
    })

    bot.on('spawn', () => {
      e.spawned = true
      e.home = bot.entity && bot.entity.position ? { x: bot.entity.position.x, z: bot.entity.position.z } : null
      setTimeout(() => e.authNow(), 400)
      this.stopWalk(e)
      if (e.walkOn) this.startWalkLoop(e)
      this.startAntiAfk(e)
      this.emitState()
    })

    bot.on('messagestr', (str) => {
      const t = (str || '').trim()
      if (!t) return
      const msg = { ts: Date.now(), sys: false, text: t }
      e.chat.push(msg)
      if (e.chat.length > 90) e.chat.splice(0, e.chat.length - 90)
      this.io.emit('chat:msg', { nick: e.nick, ts: msg.ts, sys: false, text: t })
      if (!e.authed) {
        if (/\/register/i.test(t) && /используй|команду|пожалуйста|please|use/i.test(t)) e.promptReg = true
        if (/\/login/i.test(t) && /используй|команду|пожалуйста|please|use|войд/i.test(t)) e.promptLogin = true
        if (e.promptReg || e.promptLogin) {
          e.promptReg = false
          e.promptLogin = false
          setTimeout(() => e.authNow(), 350)
        }
      }
      if (/успешно (зарегистр|авториз)|(вы )?зарегистрирован|registered success/i.test(t)) {
        e.registered = true
        e.authed = true
        this.save()
      } else if (/уже зарегистр|already registered/i.test(t)) {
        e.registered = true
        this.save()
      }
      if (/успешно вошли|вы вошли|logged in|login success|вход выполнен/i.test(t)) {
        e.authed = true
      }
    })

    bot.on('kicked', (reason) => {
      let r = reason
      if (typeof r === 'object') {
        try { r = JSON.stringify(r) } catch (err) {}
      }
      console.log(`[${e.nick}] KICKED: ` + String(r).slice(0, 200))
      this.sysLine(e, 'кикнут сервером: ' + String(r).slice(0, 140))
      this.emitState()
    })

    bot.on('error', (err) => {
      e.lastError = String((err && err.message) || err).slice(0, 140)
      console.log(`[${e.nick}] ERROR: ` + e.lastError)
      this.sysLine(e, 'ошибка: ' + e.lastError)
      this.emitState()
    })

    bot.on('death', () => {
      e.spawned = false
      this.stopControls(bot)
      this.emitState()
    })

    bot.on('end', () => {
      e.bot = null
      e.online = false
      e.connecting = false
      e.spawned = false
      ++e.authSeq
      this.stopWalk(e)
      this.stopAntiAfk(e)
      this.sysLine(e, 'отключился')
      if (e.status === 'wl') this.scheduleReconnect(e)
      this.emitState()
      this.maybeConnect()
    })
  }

  startAntiAfk (e) {
    if (e.antiAfkTimer) return
    e.lastMoveAt = Date.now()
    e.lastPos = null
    e.antiAfkTimer = setInterval(() => {
      const bot = e.bot
      if (!bot || !e.spawned) return
      const pos = bot.entity && bot.entity.position
      if (!pos) return
      if (e.lastPos) {
        const dx = pos.x - e.lastPos.x
        const dz = pos.z - e.lastPos.z
        if (dx * dx + dz * dz > 0.25) {
          e.lastMoveAt = Date.now()
          e.lastPos = pos
          return
        }
      }
      e.lastPos = pos
      const idle = Date.now() - (e.lastMoveAt || Date.now())
      if (idle > 210000) {
        console.log('[' + e.nick + '] anti-afk nudge (стоял ' + Math.round(idle / 1000) + 'с)')
        e.lastMoveAt = Date.now()
        const yt = e.walkToken
        const yaw = Math.random() * Math.PI * 2
        try { bot.look(yaw, 0, true) } catch (err) {}
        try { bot.setControlState('jump', true) } catch (err2) {}
        setTimeout(() => {
          if (e.walkToken === yt && e.bot) {
            try { e.bot.setControlState('jump', false) } catch (err3) {}
          }
        }, 600)
      }
    }, 20000)
  }

  stopAntiAfk (e) {
    if (e.antiAfkTimer) {
      clearInterval(e.antiAfkTimer)
      e.antiAfkTimer = null
    }
  }

  scheduleReconnect (e) {
    if (e.reconnectTimer) return
    const delay = Math.min(e.reconnectDelay, 900000)
    e.reconnectDelay = Math.min(e.reconnectDelay * 1.75, 900000)
    this.sysLine(e, 'переподключение через ' + Math.round(delay / 1000) + ' сек')
    e.reconnectTimer = setTimeout(() => {
      e.reconnectTimer = null
      if (e.status !== 'wl' || e.online || e.connecting) return
      if (!this.queue.includes(e.nick)) this.queue.push(e.nick)
      this.maybeConnect()
    }, delay)
  }

  stopControls (bot) {
    try {
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } catch (err) {}
  }

  stopWalk (e) {
    ++e.walkToken
    if (e.walkTimer) {
      clearTimeout(e.walkTimer)
      e.walkTimer = null
    }
    if (e.bot) this.stopControls(e.bot)
  }

  startWalkLoop (e) {
    const myToken = ++e.walkToken
    const step = () => {
      if (e.walkToken !== myToken) return
      const bot = e.bot
      if (!bot || !e.online || !e.walkOn || !e.spawned) return
      const pos = bot.entity && bot.entity.position
      if (!pos) {
        e.walkTimer = setTimeout(step, 600)
        return
      }
      let ox
      let oz
      if (e.home) {
        const dx = e.home.x - pos.x
        const dz = e.home.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist > 14) {
          ox = dx
          oz = dz
        } else {
          const a = Math.random() * Math.PI * 2
          const r = Math.random() * 4
          ox = Math.cos(a) * r
          oz = Math.sin(a) * r
        }
      } else {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * 3
        ox = Math.cos(a) * r
        oz = Math.sin(a) * r
      }
      try {
        bot.lookAt(pos.offset(ox, 0, oz), true).catch(() => {})
      } catch (err) {}
      bot.setControlState('forward', true)
      if (Math.random() < 0.75) {
        const jd = 300 + Math.random() * 700
        setTimeout(() => {
          if (e.walkToken === myToken && e.bot) e.bot.setControlState('jump', true)
        }, jd)
        setTimeout(() => {
          if (e.bot) e.bot.setControlState('jump', false)
        }, jd + 650)
      }
      e.walkTimer = setTimeout(() => {
        if (e.walkToken !== myToken) return
        if (e.bot) e.bot.setControlState('forward', false)
        e.walkTimer = setTimeout(step, 350 + Math.random() * 900)
      }, 1600 + Math.random() * 2600)
    }
    step()
  }
}

module.exports = { BotFarm }
