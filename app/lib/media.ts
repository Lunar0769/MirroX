export function createDummyVideoTrack(): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  
  const ctx = canvas.getContext("2d");
  
  let dots = 0;
  const draw = () => {
    if (ctx) {
      ctx.fillStyle = "#18181b"; // zinc-900
      ctx.fillRect(0, 0, 640, 480);
      
      ctx.fillStyle = "#a1a1aa"; // zinc-400
      ctx.font = "24px sans-serif";
      ctx.textAlign = "center";
      
      const text = "Waiting for screen share" + ".".repeat(dots);
      ctx.fillText(text, 320, 240);
      
      dots = (dots + 1) % 4;
    }
  };
  
  draw();
  // Draw continuously at ~2fps to ensure WebRTC pushes frames and keeps the connection active
  setInterval(draw, 500);
  
  // Type assertion since captureStream is sometimes missing in TS DOM typings
  const stream = (canvas as any).captureStream(2) as MediaStream;
  return stream.getVideoTracks()[0];
}
