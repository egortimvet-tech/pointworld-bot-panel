const socket = io()
let bots = []
let sel = null
let tab = 'wl'
const CH = {}

const $ = (id) => document.getElementById(id)

function esc (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmt (ts) {
  const d = new Date(ts || Date.now())
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function statusOf (b) {
  if (b.online) return { t: 'онлайн', c: 'online' }
  if (b.connecting) return { t: 'подкл…', c: 'mid' }
  if (b.queued) return { t: 'очередь', c: 'mid' }
  return { t: 'офлайн', c: 'off' }
}

function rowHtml (b) {
  const st = statusOf(b)
  const btn = tab === 'wl'
    ? '<button class="mini kick" data-a="kick">КИК</button>'
    : '<button class="mini accept" data-a="accept">ПРИНЯТЬ</button>'
  const selCls = sel === b.nick ? ' sel' : ''
  return '<div class="row' + selCls + '" data-n="' + esc(b.nick) + '"><div><div class="nick">' + esc(b.nick) + '</div><span class="chip ' + st.c + '">' + st.t + '</span></div>' + btn + '</div>'
}

function selected () {
  return bots.find(b => b.nick === sel)
}

function render () {
  $('tab-wl').classList.toggle('active', tab === 'wl')
  $('tab-bl').classList.toggle('active', tab === 'bl')
  $('list-wl').style.display = tab === 'wl' ? 'flex' : 'none'
  $('list-bl').style.display = tab === 'bl' ? 'flex' : 'none'
  const arr = bots.filter(b => tab === 'wl' ? b.status === 'wl' : b.status !== 'wl')
  $(tab === 'wl' ? 'list-wl' : 'list-bl').innerHTML = arr.map(rowHtml).join('')
  if (sel && !bots.some(b => b.nick === sel)) sel = null
  renderCard()
  document.body.classList.toggle('noselect', !sel)
}

function renderCard () {
  const b = selected()
  if (!b) {
    $('ph').style.display = 'block'
    $('card').style.display = 'none'
    return
  }
  $('ph').style.display = 'none'
  $('card').style.display = 'block'
  $('botname').textContent = b.nick
  const st = statusOf(b)
  const ch = $('botchip')
  ch.textContent = st.t
  ch.className = 'chip ' + st.c
  $('btn-walk').disabled = !b.online
  $('btn-stop').disabled = !b.online
  $('boterr').textContent = b.lastError
    ? ('Ошибка: ' + b.lastError)
    : (b.queued && !b.online ? 'Ждёт свободного слота…' : '')
  renderChat()
  const canChat = b.online
  $('chatsend').disabled = !canChat
  $('chatinput').disabled = !canChat
  $('chatinput').placeholder = canChat ? 'Введите сообщение...' : 'Бот офлайн'
}

function renderChat () {
  if (!sel) return
  const lines = CH[sel] || []
  $('chatlog').innerHTML = lines.map(m =>
    '<div class="mline' + (m.sys ? ' sys' : '') + '"><span class="tm">' + fmt(m.ts) + '</span>' + esc(m.text) + '</div>'
  ).join('')
  $('chatlog').scrollTop = $('chatlog').scrollHeight
}

socket.on('bots', (list) => {
  bots = list
  render()
})

socket.on('chat:msg', (m) => {
  if (!m || !m.nick) return
  if (!CH[m.nick]) CH[m.nick] = []
  CH[m.nick].push(m)
  if (CH[m.nick].length > 200) CH[m.nick].shift()
  if (sel === m.nick) renderChat()
})

socket.on('chat:log', (d) => {
  if (!d || !d.nick) return
  CH[d.nick] = (d.lines || []).slice(-200)
  if (sel === d.nick) renderChat()
})

$('tab-wl').onclick = () => { tab = 'wl'; render() }
$('tab-bl').onclick = () => { tab = 'bl'; render() }

function listClick (e) {
  const row = e.target.closest('.row')
  if (!row) return
  const nick = row.dataset.n
  const btn = e.target.closest('button.mini')
  if (btn && btn.dataset.a === 'accept') {
    socket.emit('bot:accept', { nick })
    sel = nick
    tab = 'wl'
    render()
    socket.emit('chat:sub', { nick })
    return
  }
  if (btn && btn.dataset.a === 'kick') {
    socket.emit('bot:kick', { nick })
    if (sel === nick) sel = null
    render()
    return
  }
  sel = nick
  render()
  socket.emit('chat:sub', { nick })
}

$('list-wl').addEventListener('click', listClick)
$('list-bl').addEventListener('click', listClick)

$('btn-walk').onclick = () => { if (sel) socket.emit('bot:walk', { nick: sel, on: true }) }
$('btn-stop').onclick = () => { if (sel) socket.emit('bot:walk', { nick: sel, on: false }) }

$('chatform').addEventListener('submit', (ev) => {
  ev.preventDefault()
  const v = $('chatinput').value.trim()
  if (!v || !sel) return
  socket.emit('bot:say', { nick: sel, text: v })
  $('chatinput').value = ''
})

$('grid').innerHTML = Array.from({ length: 36 }, () => '<div class="cell"></div>').join('')
