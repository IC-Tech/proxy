const net = require('net')
const url = require('url')
const fs = require('fs')
const path = require('path')

const PORT = 41250
var logStream = fs.createWriteStream(path.join(path.dirname(__filename), '../logs.txt'), {flags:'a'})

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
last = {}

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
		if((tls = a.startsWith('CONNECT '))) a = url.parse('http://' + a.substr(8, a.indexOf(' ', 9)))
		else if(req.indexOf('Host: ') >= 0) a = url.parse(a.split(' ')[1])
		if(a && a.hostname && !a.port) a.port = a.protocol == 'https:' ? 443 : 80
		if(!a || !a.hostname || !a.port) {
			log('CLIENT INVALID', id, adr)
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
