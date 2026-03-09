const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_TLS_DIR = path.join(__dirname, '..', '..', 'data', 'tls');
const CERT_FILE = 'cert.pem';
const KEY_FILE = 'key.pem';

/**
 * Generate a self-signed certificate using Node.js crypto.
 * Returns { cert, key } PEM strings.
 */
function generateSelfSignedCert(hostname = 'localhost') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build a self-signed X.509 certificate using the built-in X509Certificate API
    // Node 20+ has crypto.X509Certificate but not a builder, so we use the legacy
    // approach: create a CSR-like structure and self-sign it.
    //
    // Since Node.js doesn't have a native cert builder, we'll use a minimal
    // ASN.1/DER approach to create a proper self-signed cert.
    const cert = createSelfSignedCert(privateKey, publicKey, hostname);

    return { cert, key: privateKey };
}

/**
 * Create a self-signed X.509 v3 certificate in PEM format.
 * Uses raw ASN.1 DER encoding — no external dependencies.
 */
function createSelfSignedCert(privateKeyPem, publicKeyPem, hostname) {
    // Extract the raw public key bytes from the PEM
    const pubKeyDer = pemToDer(publicKeyPem, 'PUBLIC KEY');

    // Serial number (random 16 bytes)
    const serial = crypto.randomBytes(16);
    serial[0] &= 0x7F; // Ensure positive

    // Validity: now to +90 days
    const notBefore = new Date();
    const notAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // Subject/Issuer: CN=hostname, O=NXVNC Self-Signed
    const issuer = buildName(hostname);
    const subject = issuer;

    // Subject Alternative Names extension
    const sanExt = buildSANExtension(hostname);

    // TBS (To Be Signed) Certificate
    const tbs = buildTBSCertificate(serial, issuer, notBefore, notAfter, subject, pubKeyDer, sanExt);

    // Sign the TBS
    const signer = crypto.createSign('SHA256');
    signer.update(tbs);
    const signature = signer.sign(privateKeyPem);

    // Build the full certificate
    const cert = buildCertificate(tbs, signature);

    return derToPem(cert, 'CERTIFICATE');
}

// --- ASN.1 DER helpers ---

function tag(tagByte, content) {
    const len = encodeLength(content.length);
    return Buffer.concat([Buffer.from([tagByte]), len, content]);
}

function seq(...items) {
    const content = Buffer.concat(items);
    return tag(0x30, content);
}

function set(...items) {
    const content = Buffer.concat(items);
    return tag(0x31, content);
}

function integer(buf) {
    // Ensure positive (prepend 0x00 if high bit set)
    if (buf[0] & 0x80) {
        buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return tag(0x02, buf);
}

function oid(dotNotation) {
    const parts = dotNotation.split('.').map(Number);
    const bytes = [40 * parts[0] + parts[1]];
    for (let i = 2; i < parts.length; i++) {
        let val = parts[i];
        if (val < 128) {
            bytes.push(val);
        } else {
            const encoded = [];
            encoded.push(val & 0x7F);
            val >>= 7;
            while (val > 0) {
                encoded.push((val & 0x7F) | 0x80);
                val >>= 7;
            }
            encoded.reverse();
            bytes.push(...encoded);
        }
    }
    return tag(0x06, Buffer.from(bytes));
}

function utf8String(str) {
    return tag(0x0C, Buffer.from(str, 'utf8'));
}

function bitString(buf) {
    return tag(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
}

function contextTag(num, content) {
    return tag(0xA0 | num, content);
}

function encodeLength(len) {
    if (len < 128) return Buffer.from([len]);
    const bytes = [];
    let temp = len;
    while (temp > 0) {
        bytes.unshift(temp & 0xFF);
        temp >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeUTCTime(date) {
    const s = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
    return tag(0x17, Buffer.from(s, 'ascii'));
}

function encodeGeneralizedTime(date) {
    const s = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    return tag(0x18, Buffer.from(s, 'ascii'));
}

function pemToDer(pem, label) {
    const b64 = pem.replace(new RegExp(`-----BEGIN ${label}-----`), '')
        .replace(new RegExp(`-----END ${label}-----`), '')
        .replace(/\s/g, '');
    return Buffer.from(b64, 'base64');
}

function derToPem(der, label) {
    const b64 = der.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

// SHA-256 with RSA OID
function sha256WithRSA() {
    return seq(oid('1.2.840.113549.1.1.11'), tag(0x05, Buffer.alloc(0))); // NULL
}

function buildName(cn) {
    return seq(
        set(seq(oid('2.5.4.10'), utf8String('NXVNC Self-Signed'))),
        set(seq(oid('2.5.4.3'), utf8String(cn)))
    );
}

function buildSANExtension(hostname) {
    // subjectAltName OID: 2.5.29.17
    const names = [];
    // DNS name
    names.push(tag(0x82, Buffer.from(hostname, 'ascii'))); // dNSName
    // Also add localhost and common IPs
    if (hostname !== 'localhost') {
        names.push(tag(0x82, Buffer.from('localhost', 'ascii')));
    }
    // IP: 127.0.0.1
    names.push(tag(0x87, Buffer.from([127, 0, 0, 1]))); // iPAddress
    // IP: ::1
    names.push(tag(0x87, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])));

    const sanValue = seq(...names);

    return seq(
        oid('2.5.29.17'),
        tag(0x04, sanValue) // OCTET STRING wrapping
    );
}

function buildTBSCertificate(serial, issuer, notBefore, notAfter, subject, pubKeyDer, sanExt) {
    return seq(
        contextTag(0, integer(Buffer.from([0x02]))), // version 3
        integer(serial),
        sha256WithRSA(),
        issuer,
        seq(encodeUTCTime(notBefore), encodeUTCTime(notAfter)),
        subject,
        pubKeyDer, // SubjectPublicKeyInfo is already a complete SEQUENCE
        contextTag(3, seq(sanExt)) // extensions
    );
}

function buildCertificate(tbs, signature) {
    return seq(
        tbs,
        sha256WithRSA(),
        bitString(signature)
    );
}

// --- Public API ---

/**
 * Ensure TLS cert/key exist. Returns { certPath, keyPath, selfSigned }.
 * If user provides tlsCert/tlsKey in config, uses those.
 * Otherwise auto-generates a self-signed cert.
 */
function ensureTLS(config) {
    // User-provided certs take priority
    if (config.tlsCert && config.tlsKey) {
        if (fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey)) {
            // Check expiry of user-provided cert
            try {
                const certPem = fs.readFileSync(config.tlsCert, 'utf8');
                const x509 = new crypto.X509Certificate(certPem);
                const validTo = new Date(x509.validTo);
                const daysLeft = (validTo - Date.now()) / (24 * 60 * 60 * 1000);
                if (daysLeft <= 0) {
                    console.error('[tls] WARNING: User-provided certificate has EXPIRED!');
                } else if (daysLeft <= 30) {
                    console.warn(`[tls] WARNING: User-provided certificate expires in ${Math.floor(daysLeft)} days`);
                }
            } catch (e) {
                console.error('[tls] WARNING: Could not read user-provided certificate:', e.message);
            }
            return { certPath: config.tlsCert, keyPath: config.tlsKey, selfSigned: false };
        }
        console.error(`[tls] Configured cert/key not found: ${config.tlsCert}, ${config.tlsKey}`);
        console.error('[tls] Falling back to self-signed certificate');
    }

    const certPath = path.join(DEFAULT_TLS_DIR, CERT_FILE);
    const keyPath = path.join(DEFAULT_TLS_DIR, KEY_FILE);

    // Check if self-signed cert already exists and is not expired
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        try {
            const certPem = fs.readFileSync(certPath, 'utf8');
            const x509 = new crypto.X509Certificate(certPem);
            const validTo = new Date(x509.validTo);
            const daysLeft = (validTo - Date.now()) / (24 * 60 * 60 * 1000);

            if (daysLeft > 30) {
                console.log(`[tls] Using existing self-signed certificate (expires: ${validTo.toLocaleDateString()}, ${Math.floor(daysLeft)} days remaining)`);
                return { certPath, keyPath, selfSigned: true };
            }
            console.log('[tls] Self-signed certificate expiring soon, regenerating...');
        } catch (e) {
            console.log('[tls] Existing certificate invalid, regenerating...');
        }
    }

    // Generate new self-signed cert
    if (!fs.existsSync(DEFAULT_TLS_DIR)) {
        fs.mkdirSync(DEFAULT_TLS_DIR, { recursive: true });
    }

    console.log('[tls] Generating self-signed certificate...');
    const { cert, key } = generateSelfSignedCert('localhost');
    fs.writeFileSync(certPath, cert, 'utf8');
    fs.writeFileSync(keyPath, key, 'utf8');
    console.log('[tls] Self-signed certificate generated (valid for 90 days)');

    return { certPath, keyPath, selfSigned: true };
}

/**
 * Get info about the current TLS certificate.
 */
function getCertInfo(certPath) {
    try {
        const certPem = fs.readFileSync(certPath, 'utf8');
        const x509 = new crypto.X509Certificate(certPem);
        return {
            subject: x509.subject,
            issuer: x509.issuer,
            validFrom: x509.validFrom,
            validTo: x509.validTo,
            fingerprint: x509.fingerprint256,
            selfSigned: x509.subject === x509.issuer,
            serialNumber: x509.serialNumber,
        };
    } catch (e) {
        return null;
    }
}

/**
 * Monitor certificate expiry on a running server.
 * For self-signed certs: auto-regenerate if <= 30 days remaining.
 * For user-provided certs: log warnings at 30, 14, 7, 1, 0 days.
 */
function monitorCertExpiry(server, config, tlsInfo) {
    const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

    setInterval(() => {
        try {
            const certPath = tlsInfo.certPath;
            const certPem = fs.readFileSync(certPath, 'utf8');
            const x509 = new crypto.X509Certificate(certPem);
            const validTo = new Date(x509.validTo);
            const daysLeft = (validTo - Date.now()) / (24 * 60 * 60 * 1000);

            if (tlsInfo.selfSigned) {
                if (daysLeft <= 30) {
                    console.log('[tls] Self-signed certificate expiring soon, regenerating...');
                    const { cert, key } = generateSelfSignedCert('localhost');
                    fs.writeFileSync(tlsInfo.certPath, cert, 'utf8');
                    fs.writeFileSync(tlsInfo.keyPath, key, 'utf8');

                    // Reload TLS context on the running server
                    server.setSecureContext({
                        cert: fs.readFileSync(tlsInfo.certPath),
                        key: fs.readFileSync(tlsInfo.keyPath),
                    });
                    console.log('[tls] Self-signed certificate regenerated and reloaded (valid for 90 days)');
                }
            } else {
                // User-provided cert - just warn
                if (daysLeft <= 0) {
                    console.error('[tls] WARNING: TLS certificate has EXPIRED! Replace immediately.');
                } else if (daysLeft <= 1) {
                    console.error(`[tls] CRITICAL: TLS certificate expires in less than 1 day!`);
                } else if (daysLeft <= 7) {
                    console.warn(`[tls] WARNING: TLS certificate expires in ${Math.floor(daysLeft)} days`);
                } else if (daysLeft <= 14) {
                    console.warn(`[tls] NOTICE: TLS certificate expires in ${Math.floor(daysLeft)} days`);
                } else if (daysLeft <= 30) {
                    console.log(`[tls] INFO: TLS certificate expires in ${Math.floor(daysLeft)} days`);
                }
            }
        } catch (err) {
            console.error('[tls] Certificate monitoring error:', err.message);
        }
    }, CHECK_INTERVAL);
}

module.exports = { ensureTLS, getCertInfo, generateSelfSignedCert, monitorCertExpiry };
