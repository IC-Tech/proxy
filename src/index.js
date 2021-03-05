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


const write = (sock, a) => {
	if(typeof a == 'undefined') {
		a = sock
		sock = 0
	}
	a = Buffer.concat(a.map(a => a instanceof Buffer ? a : Buffer.from(typeof a == 'number' ? [a] : a)))
	if(sock) sock.write(a)
	return a
}
const parse_socks = async (sock, data) => {
	if(data[0] != 5) return [0, forceEnd(sock)]
	var a = data.slice(2, data[1] + 2)
	//if(auth) {
	//	if(a.some(a => a == 2)) {
	//		sock.socks5_auth = 1
	//		sock.write(Buffer.from([5, 2]))
	//	}
	//	else return forceEnd(sock, Buffer.from([5, 255]))
	//}
	//else 
	write(sock, [5, 0])
	return new Promise(_ => sock.once('data', data => _((_ =>{
		if(data[0] != 5 || data.length < 8) return [0, forceEnd(sock)]
		var a = {cmd: data[1], atyp: data[3]}
		if(
			data[2] != 0 ||
			//![1,2,3].some(b => a.cmd == b) ||
			a.cmd != 1 ||
			![1,3,4].some(b => a.atyp == b)
		) return [0, forceEnd(sock)]
		if(a.atyp == 1) a.adrl = [4, 8]
		else if(a.atyp == 3) a.adrl = [4, data[4] + 5]
		else if(a.atyp == 4) a.adrl = [4, 20]
		a.adr = data.slice(...a.adrl)
		a.prt = data.slice(a.adrl[1], a.adrl[1] + 2)
		a.port = 0
		for (var i = 0; i < a.prt.length; i++) a.port |= (a.prt[i] << (8 * (a.prt.length - i - 1)))
		if(a.atyp == 1) a.addr = Array.from(a.adr).map(a => a.toString()).join('.')
		else if(a.atyp == 4) {
			a.addr = []
			a._ = Array.from(a.adr).map(a => a.toString(16).padStart(2, '0'))
			for (var i = 0; i < a._.length; i+=2) a.addr.push(a._[i] + a._[i + 1])
			a.addr = a.addr.join(':')
		}
		else a.addr = a.adr.slice(1).toString()
		sock.socks5 = 1
		sock.a = a
		return [1, {
			sock,
			a: {hostname: a.addr, port: a.port},
			con: sock => write(sock, [5, 0, 0, sock.a.atyp, sock.a.adr, sock.a.prt])
		}]
	})())))
}
const parse_http = async (sock, data) => {
	var req = (data.length < 1024 ? data : data.slice(0, 1024)).toString()
	var a = req.substr(0, req.indexOf('\r')), tls = 0
	if((tls = a.startsWith('CONNECT '))) a = a.split(' ')[1]
	else if((a = req.indexOf('Host: ')) >= 0) a = (a = req.substr(a)).substr(0, a.indexOf('\r')).split(' ')[1]
	else a = 0
	if(a !== 0) a = url.parse((a.match(/[\w]*:\/\//) ? '' : 'http://') + a)
	if(a && a.hostname && !a.port) a.port = a.protocol == 'https:' ? 443 : 80
	if(!a || !a.hostname || !a.port) {
		log('CLIENT INVALID', id, adr)
		return [0, forceEnd(sock, httpErr(400))]
	}
	sock.a = a
	sock.tls = tls
	return [1, {
		sock,
		a,
		tls,
		con: (sock, res, data) => {
			if(sock, tls) {
				sock.write([
					'HTTP/1.1 200 Connection Established',
					'Proxy-agent: IC-Tech Proxy/1.0',
				].join('\r\n'))
				sock.write('\r\n\r\n')
			}
			else res.write(data.toString().replace(/(\w+ )([^ ]*?)( HTTP)/i, (a,b,c,d) => b + url.parse(c).path + d))
		}
	}]
}

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

	sock.once('data', async data => {
		var b = await (data[0] <= 5 ? parse_socks(sock, data) : parse_http(sock, data))
		if(b[0] == 0) return
		var a = (b = b[1]).a, tls = b.tls
		sock = b.sock

		res = net.connect(a.port, a.hostname)
		name = a.hostname + ':' + a.port

		res.on('error', e => {
			if(res.calc) {
				stats.upload += res.bytesWritten
				stats.download += res.bytesRead
				res.calc = 0
			}
			var eok, erep
			if(eok = erep = ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].some(a => e.code == a)) forceEnd(sock, sock.socks5 ? (!sock.connected && write([5, 4, 0, sock.a.atyp, sock.a.adr, sock.a.prt])) : httpErr(404))
			if(eok = erep = ['ENETUNREACH', 'ECONNABORTED', 'ECONNREFUSED'].some(a => e.code == a)) forceEnd(sock, sock.socks5 ? (!sock.connected && write([5, 5, 0, sock.a.atyp, sock.a.adr, sock.a.prt])) : httpErr(400))
			if(eok = (e.code == 'ECONNRESET' || e.code == 'EPIPE')) forceEnd(sock)

			if(res && res.readyState != 'closed') forceEnd(res)

			if(!eok || erep) {
				log('SERVER ERROR', id, adr, '=>', name)
				error(e)
			}
			if(!eok && sock && sock.readyState != 'closed') forceEnd(sock, !sock.socks5 && httpErr(500))
		})

		res.on('connect', () => {
			log(`CONNECT ${tls && 'TLS ' || ''}SERVER`, id, adr, '=>', name)
			if(res.remotePort == PORT && res.remoteAddress == res.localAddress) {
				log(`CLOSE ECHO`, id, adr, '=>', name)
				forceEnd(sock, sock.socks5 ? write([5, 2, 0, sock.a.atyp, sock.a.adr, sock.a.prt]) : httpErr(400))
				return forceEnd(res)
			}

			res.calc = 1
			sock.connected = 1

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

			if(b.con) b.con(sock, res, data)
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
