// ============================================================================
// DAR O QUITAR EL PERMISO DE SUBIR CANCIONES DESDE LA WEB
// ============================================================================
//
// Uso:
//   node scripts/set-upload-permission.js correo@ejemplo.com            (concede)
//   node scripts/set-upload-permission.js correo@ejemplo.com --revoke   (revoca)
//   node scripts/set-upload-permission.js --list                        (lista quién lo tiene)
//
// Pone `canUpload: true|false` en users/{uid}. Las reglas de Firestore solo
// dejan modificar ese campo a un admin, por eso se hace con el Admin SDK.
// Los admins (`isAdmin: true`) pueden subir siempre, no necesitan el campo.
//
// Requisitos: la misma cuenta de servicio que usa scripts/upload-songs.js.
// ============================================================================

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function listUploaders() {
    const [porCampo, admins] = await Promise.all([
        db.collection('users').where('canUpload', '==', true).get(),
        db.collection('users').where('isAdmin', '==', true).get()
    ]);
    console.log('Admins (suben siempre):');
    admins.docs.forEach(d => console.log(`  ${d.data().email || '(sin email)'}  [${d.id}]`));
    console.log('Con canUpload: true:');
    if (porCampo.empty) console.log('  (nadie)');
    porCampo.docs.forEach(d => console.log(`  ${d.data().email || '(sin email)'}  [${d.id}]`));
}

async function setPermission(email, value) {
    const user = await admin.auth().getUserByEmail(email);
    const ref = db.collection('users').doc(user.uid);
    const doc = await ref.get();
    if (!doc.exists) {
        // El documento se crea normalmente al iniciar sesión por primera vez;
        // si aún no existe, se crea aquí con lo mínimo.
        await ref.set({
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isAdmin: false,
            canUpload: value
        });
        console.log(`Documento de usuario creado para ${email} con canUpload=${value}`);
    } else {
        await ref.update({ canUpload: value });
        console.log(`${email} [${user.uid}] → canUpload=${value}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--list')) {
        await listUploaders();
        return;
    }
    const email = args.find(a => !a.startsWith('--'));
    if (!email) {
        console.error('Uso: node scripts/set-upload-permission.js <email> [--revoke] | --list');
        process.exit(1);
    }
    await setPermission(email, !args.includes('--revoke'));
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
