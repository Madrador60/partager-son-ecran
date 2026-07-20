window.RAPerf = (() => {
  const profiles = {
    auto:{id:"auto",name:"Automatique",width:1920,height:1080,fps:120,bitrate:45000000},
    ultra:{id:"ultra",name:"Ultra fluidité",width:1920,height:1080,fps:120,bitrate:45000000},
    balanced:{id:"balanced",name:"Équilibré",width:1920,height:1080,fps:60,bitrate:24000000},
    quality:{id:"quality",name:"Qualité",width:2560,height:1440,fps:60,bitrate:40000000},
    low:{id:"low",name:"Connexion faible",width:1280,height:720,fps:60,bitrate:10000000}
  };
  async function apply(peer, profile) {
    const sender = peer?.getSenders?.().find(s => s.track?.kind === "video");
    if (!sender) return;
    const p = sender.getParameters();
    p.degradationPreference = "maintain-framerate";
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    Object.assign(p.encodings[0], {
      maxBitrate: profile.bitrate,
      maxFramerate: profile.fps,
      priority: "high",
      networkPriority: "high"
    });
    try { await sender.setParameters(p); } catch (e) { console.warn(e); }
  }
  function adaptive(s) {
    if (s.rtt > 100 || s.loss > 4) return profiles.low;
    if (s.rtt > 55 || s.loss > 1.5) return profiles.balanced;
    return profiles.ultra;
  }
  function monitor(peer, cb) {
    let bytes = 0, time = performance.now();
    return setInterval(async () => {
      const out = {sent:0,recv:0,rtt:0,mbps:0,loss:0,codec:"—",resolution:"—"};
      const stats = await peer.getStats();
      let lost=0, received=0;
      stats.forEach(x => {
        if (x.type==="outbound-rtp" && x.kind==="video") {
          const now=performance.now(), sec=Math.max(.001,(now-time)/1000), current=x.bytesSent||0;
          out.mbps=Math.max(0,(current-bytes)*8/sec/1e6); bytes=current; time=now; out.sent=x.framesPerSecond||0;
          if(x.frameWidth&&x.frameHeight) out.resolution=`${x.frameWidth}×${x.frameHeight}`;
        }
        if (x.type==="inbound-rtp" && x.kind==="video") {
          out.recv=x.framesPerSecond||0; lost=x.packetsLost||0; received=x.packetsReceived||0;
          if(x.frameWidth&&x.frameHeight) out.resolution=`${x.frameWidth}×${x.frameHeight}`;
        }
        if (x.type==="candidate-pair" && x.state==="succeeded") out.rtt=Math.round((x.currentRoundTripTime||0)*1000);
        if (x.type==="remote-inbound-rtp" && x.kind==="video") out.rtt=Math.round((x.roundTripTime||0)*1000)||out.rtt;
        if (x.type==="codec" && x.mimeType?.startsWith("video/")) out.codec=x.mimeType.slice(6);
      });
      out.loss=(received+Math.max(0,lost)) ? Math.max(0,lost/(received+Math.max(0,lost))*100) : 0;
      cb(out);
    },1000);
  }
  return {profiles,apply,adaptive,monitor};
})();
