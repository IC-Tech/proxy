const net = require('net')
const url = require('url')
const fs = require('fs')
const path = require('path')

const PORT = 41251
const DIR = path.join(path.dirname(__filename), '../')
var logStream = fs.createWriteStream(DIR + 'logs.txt', {flags:'a'})

var TimezoneOffset = new Date().getTimezoneOffset()
var _TimezoneOffset = parseInt(TimezoneOffset / -60)
_TimezoneOffset = (_TimezoneOffset < 0 ? '' : '+') + _TimezoneOffset + ':' + (TimezoneOffset * -1 - _TimezoneOffset * 60)
TimezoneOffset = TimezoneOffset * 60 * 1000

var stats = {
	upload: 0,
	download: 0,
	errors: 0,
	connections: 0,
	totalconnections: 0,
},
last = {},
access = [],
allow = [],
block = [],
unknown = []

try {
	access = JSON.parse(fs.readFileSync(DIR + 'access.json'))
}
catch {
	try {
		access = JSON.parse(fs.readFileSync(DIR + 'access-backup.json'))
	}
	catch {
		access = []
	}
}
// types
//   - 0 block (no need for this)
//   - 1 allow
access.forEach(a => a.b == 1 ? allow.push(a.a) : block.push(a.a))
const set_access = a => {
	var b = []
	a.allow.forEach(a => b.push({a, b: 1}))
	a.block.forEach(a => b.push({a, b: 0}))
	fs.writeFileSync(DIR + 'access-backup.json', JSON.stringify(access))
	fs.writeFileSync(DIR + 'access.json', JSON.stringify(access = b))
}

const _check_access = (a, list) => list.some(b => {
	var c = 0
	if(b[0] == '\/') {
		c = (b = b.substr(1)).match(/([^]*?)\/([\w]*$)/)
		if(!c) return 0
		c = new RegExp(c[1], c[2])
		return c.exec(a) ? 1 : 0
	}
	if(b[0] == '.') c = 1
	if(b[b.length - 1] == '.') c |= 2
	if(c == 0 && b == a) return 1
	if(c == 1 && (a.endsWith(b) || b.substr(1) == a)) return 2
	if(c == 2 && a.startsWith(b)) return 3
	if(c == 3 && a.indexOf(b) >= 0) return 4
})
const check_access = a => {
	var b = _check_access(a.hostname, allow), c = _check_access(a.hostname, block)
	if(b && !c) return 1
	if(c) return 0
	if(!unknown.some(b => b == a.hostname)) unknown.push(a.hostname)
	return 0
}
const parseIP = a => {
	var b = a.match(/([^]*):([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})$/)
	if(b) b = {ipv6: b[1], ipv4: b[2]}
	else if(b = a.match(/^[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/)) b = {ipv4: a}
	else b = {ipv6: a}
	return b
}
const pram = a => {
	if(typeof a == 'object') return Object.keys(a).map(b => b + '=' + encodeURIComponent(a[b].toString())).join('&')
	var b = {}
	var c = /(?:(?:\?|&)?([^=&?#]*)=([^=&?#]*))/g
	var d
	while((d = c.exec(a))) {
		if(!b[d[1]]) b[d[1]] = decodeURIComponent(d[2])
		else {
			if(!(b[d[1]] instanceof Array)) b[d[1]] = [b[d[1]]]
			b[d[1]].push(decodeURIComponent(d[2]))
		}
	}
	return b
}
const web = (a, data) => {
	var b = data.indexOf('\r\n')
	var c = data.slice(0, b).toString().split(' ')
	c = {meth: c[0], href: c[1]}
	b = (data = data.slice(b + 2)).indexOf('\r\n\r\n')
	if(b == -1) b = data.length
	c.head = data.slice(0, b).toString().trim().split('\r\n').map(a => {
		var b = a.indexOf(': ')
		return [a.substr(0, b), a.substr(b + 2)]
	})
	c.data = data.slice(b + 4)
	b = {}
	c.head.forEach(a => b[a[0]] = a[1])
	c.head = b
	c.url = url.parse(c.href)
	c.pram = pram(c.url.query || '')
	if(c.url.pathname == '/') {
		var res = {}
		const write = (b = {}) => a.end([
			`HTTP/1.1 ${b.meth || '200 OK'}`,
			`Date: ${(new Date()).toUTCString()}`,
			`Server: IC-Tech Proxy/1.0`,
			`Proxy-agent: IC-Tech Proxy/1.0`,
			`Content-Type: text/html`,
			`Content-Length: ${b.data && b.data.length || 0}`,
			...(Object.keys(b.head = b.head || {}).map(a => a + ': ' + b.head[a])),
			'',
			b.data || '',
			''
		].join('\r\n'))
		if(c.meth == 'GET') {
			if(c.pram['block-remove']) for (var i = block.length - 1; i >= 0; i--) if(block[i] == c.pram['block-remove']) delete block[i]
			if(c.pram['allow-remove']) for (var i = allow.length - 1; i >= 0; i--) if(allow[i] == c.pram['allow-remove']) delete allow[i]
			if(c.pram['allow'] && !allow.some(a => a == c.pram['allow'])) allow.push(c.pram['allow'])
			if(['block-remove', 'allow-remove', 'allow'].some(a => c.pram[a])) {
				for (var i = unknown.length - 1; i >= 0; i--) if(_check_access(unknown[i], allow) || _check_access(unknown[i], block)) delete unknown[i]
				allow = allow.filter(a => a)
				block = block.filter(a => a)
				unknown = unknown.filter(a => a)
				set_access({allow, block})
				return write({meth: '302 Found', head: {Location: '/'}})
			}
			return write({data: `<!DOCTYPE html><!-- Copyright © Imesh Chamara 2021 --><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><title>IC-Tech Limited Proxy Server</title><style type="text/css">body {font-family: Roboto, Ubuntu, -apple-system, BlinkMacSystemFont, "Segoe UI", Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;font-size: 14px;}body, html, #root {margin: 0;padding: 0;border: 0;width: 100%;min-height: 100vh;background-color: #fff;}.c1 {padding: 40px;}.c2 {font-size: 16px;display: block;}.c4 {display: block;}.c3 {padding: 4px 0 16px;display: flex;flex-direction: column;}.c3 > a {background-color: #ddd;color: #000;border-radius: 4px;padding: 6px 12px;margin: 2px 0;text-decoration: none;}.c5 {display: flex;flex-direction: row;justify-content: center;}</style></head><body><dir id="root"><dir class="c1"><span class="c2">Unknown requests ${
					unknown.length.toString()
				}</span><span class="c4">Click to allow</span><dir class="c3">${
					unknown.map(a => `<a href="?allow=${encodeURIComponent(a)}"><span>${a}</span></a>`).join('')
				}</dir><span class="c2">Allowed requests ${
					allow.length.toString()
				}</span><span class="c4">Click to remove from allow</span><dir class="c3">${
					allow.map(a => `<a href="?allow-remove=${encodeURIComponent(a)}"><span>${a}</span></a>`).join('')
				}</dir><span class="c2">Blocked requests ${
					block.length.toString()
				}</span><span class="c4">Click to remove from block</span><dir class="c3">${
					block.map(a => `<a href="?block-remove=${encodeURIComponent(a)}"><span>${a}</span></a>`).join('')
				}</dir><!-- div class="c5"><a href="?manual=1"><button>Add manually</button></a></div --></dir></dir></body></html>`
			})
		}
	}
	a.end(httpErr(400))
}
const log = (...a) => logStream.write((a.length > 0 && (DATE()  + ' ' + a.map(a => typeof a == 'object' ? JSON.stringify(a) : a.toString()).join(' ')) || '') + '\n'),
error = (...a) => log('[ERROR]', a),
_date = a => new Date((a || Date.now()) - TimezoneOffset),
DATE = a => (a = _date().toISOString()).substr(0, a.length - 1) + _TimezoneOffset,
Sizes = _ => {
	a = 0
	while(([_ >= 1024, ++a])[0]) _ /= 1024
	return (parseInt(_ * 100) / 100) + ' ' + (['bytes', 'Kib', 'Mib', 'Gib', 'Tib', 'Pib'][--a])
},
httpErr = a => {
	var n = ({
		'400': {t: 'Bad Request', d: ''},
		'401': {t: 'Unauthorized', d: 'request is unauthorized or unauthenticated'},
		'404': {t: 'Not Found', d: 'requested URL have removed or moved new location'},
		'500': {t: 'Internal Server Error', d: 'server encountered an internal server error and was unable to complete your request'},
	})[a]
	n.t = a + ' ' + n.t
	var b = `<html><head><title>${n.t}</title><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body bgcolor="white"><center><h1>${n.t}</h1></center><center>${n.d}</center><hr><center>IC-Tech</center></body></html>`
	return [
		`HTTP/1.1 ${n.t}`,
		`Date: ${(new Date()).toUTCString()}`,
		`Server: IC-Tech Proxy/1.0`,
		`Proxy-agent: IC-Tech Proxy/1.0`,
		`Content-Type: text/html`,
		`Content-Length: ${b.length}`,
		'',
		b,
		''
	].join('\r\n')
},
forceEnd = (a,b) => {
	if(b) a.end(b)
	else a.end()

	if(a.counter) {
		stats.connections--
		a.counter = 0
	}
	if(a.calc) {
		stats.upload += a.bytesWritten
		stats.download += a.bytesRead
		a.calc = 0
	}

	setTimeout(_ => {
		if(a && !a.destroyed) a.destroy()
	}, 5000)
}

const eq = (a, b) => {
	if(typeof a != 'object') return a == b
	var c = Object.keys(a)
	var d = Object.keys(b)
	if(c.length != d.length) return false
	if(c.some(a => !d.some(b => a == b))) return false
	return !c.some(c => !eq(a[c], b[c]))
}
setInterval(a => {
	if(eq(stats, last)) return
	last = Object.assign({}, stats)
	console.log(Object.keys(last).map(a => a + ': ' + (a == 'upload' || a == 'download' ? Sizes(last[a]) : last[a])).join(', '))
}, 1500)
const proxy = net.createServer()

proxy.on('error', (err) => {
	log('PROXY ERROR')
	error(err)
})
proxy.on('close', () => {
	log('PROXY CLOSED')
})

proxy.on('connection', sock => {
	var adr = sock.remoteAddress + ':' + sock.remotePort
	const id = stats.totalconnections++
	stats.connections++
	log('CLIENT CONNECTED', id, adr)
	sock.counter = 1

	var res, name = 'unknown'

	sock.on('end', () =>{
		if(sock.counter) {
			stats.connections--
			sock.counter = 0
		}
		log('CLIENT CLOSED', id, adr)
		if(res && res.readyState != 'closed') forceEnd(res)
		if(sock && sock.readyState != 'closed') forceEnd(sock)
	})
	sock.on('error', e => {
		if(sock.counter) {
			stats.connections--
			sock.counter = 0
		}
		if(e.code != 'EPIPE' && e.code != 'ECONNRESET' && e.code != 'EHOSTUNREACH') {
			stats.errors++
			log('CLIENT ERROR', id, adr)
			error(e)
		}
		if(res && res.readyState != 'closed') forceEnd(res)
		if(sock && sock.readyState != 'closed') forceEnd(sock)
	})

	sock.once('data', data => {
		var req = (data.length < 1024 ? data : data.slice(0, 1024)).toString()
		var a = req.substr(0, req.indexOf('\r')), tls = 0
		if((tls = a.startsWith('CONNECT '))) a = a.split(' ')[1]
		else if((a = req.indexOf('Host: ')) >= 0) a = (a = req.substr(a)).substr(0, a.indexOf('\r')).split(' ')[1]
		else a = 0
		if(a !== 0) a = url.parse((a.match(/[\w]*:\/\//) ? '' : 'http://') + a)
		if(a && a.hostname && !a.port) a.port = a.protocol == 'https:' ? 443 : 80
		if(!a || !a.hostname || !a.port) {
			log('CLIENT INVALID', id, adr)
			return forceEnd(sock, httpErr(400))
		}
		var b = [parseIP(a.hostname), parseIP(sock.localAddress)]
		if(a.hostname == 'proxy.server' || b[0].ipv6 == b[1].ipv6 || b[0].ipv4 == b[1].ipv4) return web(sock, data)
		if(!check_access(a)) {
			log('ACCESS DENIED', id, adr, a.hostname)
			return forceEnd(sock, httpErr(400))
		}
		res = net.connect(a.port, a.hostname)
		name = a.hostname + ':' + a.port

		res.on('error', e => {
			if(res.calc) {
				stats.upload += res.bytesWritten
				stats.download += res.bytesRead
				res.calc = 0
			}
			var eok, erep
			if(eok = erep = (e.code == 'ENOTFOUND' || e.code == 'ETIMEDOUT' || e.code == 'EAI_AGAIN')) forceEnd(sock, httpErr(404))
			if(eok = erep = (e.code == 'ENETUNREACH' || e.code == 'ECONNABORTED' || e.code == 'ECONNREFUSED')) forceEnd(sock, httpErr(400))
			if(eok = (e.code == 'ECONNRESET' || e.code == 'EPIPE')) forceEnd(sock)

			if(res && res.readyState != 'closed') forceEnd(res)

			if(!eok || erep) {
				log('SERVER ERROR', id, adr, '=>', name)
				error(e)
			}
			if(!eok && sock && sock.readyState != 'closed') forceEnd(sock, httpErr(500))
		})

		res.on('connect', () => {
			log(`CONNECT ${tls && 'TLS ' || ''}SERVER`, id, adr, '=>', name)
			if(res.remotePort == PORT && res.remoteAddress == res.localAddress) {
				log(`CLOSE ECHO`, id, adr, '=>', name)
				forceEnd(sock, httpErr(400))
				forceEnd(res)
			}

			res.calc = 1

			res.on('end', e => {
				if(res.calc) {
					stats.upload += res.bytesWritten
					stats.download += res.bytesRead
					res.calc = 0
				}
				log('SERVER CLOSED', id, adr, '=>', name, {upload: res.bytesWritten, download: res.bytesRead})
				if(sock && sock.readyState != 'closed') forceEnd(sock)
				if(res && res.readyState != 'closed') forceEnd(res)
			})

			if(tls) {
				sock.write([
					'HTTP/1.1 200 Connection Established',
					'Proxy-agent: IC-Tech Proxy/1.0',
				].join('\r\n'))
				sock.write('\r\n\r\n')
			}
			else res.write(data.toString().replace(/(\w+ )([^ ]*?)( HTTP)/i, (a,b,c,d) => b + url.parse(c).path + d))
			res.pipe(sock, {end: false})
			sock.pipe(res, {end: false})
		})
	})
})

log()
log()
proxy.listen(PORT, () => {
	log('opened proxy on', proxy.address())
	console.log('opened proxy on', proxy.address())
})
log('PROXY READY')
