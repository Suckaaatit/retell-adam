async function run(){try{const r=await fetch('http://127.0.0.1:3040/dashboard');console.log(r.status);console.log((await r.text()).slice(0,80));}catch(e){console.log('ERR',e.message);} }run(); 
