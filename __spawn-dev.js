const cp=require('child_process');cp.spawn('npm',['run','dev','--','--hostname','127.0.0.1','--port','3020'],{detached:true,stdio:'ignore',shell:true}).unref(); 
