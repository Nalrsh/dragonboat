import React, { useEffect, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";

interface PlayerState {
  x: number;
  y: number;
  color: string;
  name: string;
  score: number;
}

interface Keypoint {
  x: number;
  y: number;
  score?: number;
  name?: string;
}

interface GameCanvasProps {
  player?: PlayerState;
  items?: { x: number; y: number; type: "zongzi" | "boost" | "obstacle" }[];
  gameLength?: number;
}

interface PlayerMotionState {
  lastKneeY: number;
  lastElbowY: number;
  motionCount: number;
  lastMotionTime: number;
  motionFrequency: number;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ player, items, gameLength }) => {
  const detectorRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(document.createElement('video'));
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number>();
  // 扩宽赛道，延长赛道
  // 游戏主画布调大，龙舟等比例缩放
  const CANVAS_WIDTH = 1200;
  const CANVAS_HEIGHT = 900;
  const BOAT_WIDTH = 180;
  const BOAT_HEIGHT = 90;
  const [players, setPlayers] = useState<PlayerState[]>([
    { x: CANVAS_WIDTH * 0.25, y: CANVAS_HEIGHT - 100, color: "#ff5722", name: "玩家1", score: 0 },
    { x: CANVAS_WIDTH * 0.75, y: CANVAS_HEIGHT - 100, color: "#3f51b5", name: "玩家2", score: 0 },
  ]);
  const [gameInterval, setGameInterval] = useState<NodeJS.Timeout | null>(null);
  const [gameStatus, setGameStatus] = useState<"ready" | "countdown" | "playing" | "finished">("ready");
  const [countdown, setCountdown] = useState(3);
  const [winner, setWinner] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(true);
  const [showVictoryModal, setShowVictoryModal] = useState(false);
  const [motionSensitivity, setMotionSensitivity] = useState(30);

  const playerMotions = useRef<PlayerMotionState[]>([
    { lastKneeY: 0, lastElbowY: 0, motionCount: 0, lastMotionTime: 0, motionFrequency: 0 },
    { lastKneeY: 0, lastElbowY: 0, motionCount: 0, lastMotionTime: 0, motionFrequency: 0 },
  ]);
  const [motionFrequencies, setMotionFrequencies] = useState<number[]>([0, 0]);
  const playersRef = useRef(players);
  const gameStatusRef = useRef(gameStatus);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);

  useEffect(() => {
    let isMounted = true;
    const video = videoRef.current;
    video.width = 800;
    video.height = 600;
    video.style.display = 'none';
    document.body.appendChild(video);

    let stream: MediaStream | null = null;

    // 用于初始化 tfjs 后端和 detector 的异步流程
    const init = async () => {
      // 明确设置后端为 webgl，避免 webgpu 报错
      await tf.setBackend('webgl');
      await tf.ready();

      async function setupCamera() {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 800, height: 600 },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
      }

      async function initDetector() {
        detectorRef.current = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          {
            modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
            enableTracking: true,
            trackerType: poseDetection.TrackerType.BoundingBox,
            // maxPoses: 2  // MoveNet 多人模型不需要此参数，去除以消除 TS 报错
          }
        );
      }

      const detectRunningMotion = (
        keypoints: Keypoint[],
        playerIndex: number
      ): boolean => {
        // MoveNet关键点索引
        // 0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear,
        // 5: left_shoulder, 6: right_shoulder, 7: left_elbow, 8: right_elbow,
        // 9: left_wrist, 10: right_wrist, 11: left_hip, 12: right_hip,
        // 13: left_knee, 14: right_knee, 15: left_ankle, 16: right_ankle
        const leftKnee = keypoints[13];
        const rightKnee = keypoints[14];
        const leftElbow = keypoints[7];
        const rightElbow = keypoints[8];

        let motionDetected = false;
        const motionState = playerMotions.current[playerIndex];
        const currentTime = Date.now();

        const kneeSensitivity = motionSensitivity;
        const elbowSensitivity = Math.floor(motionSensitivity * 0.7);

        if (leftKnee && leftKnee.score && leftKnee.score > 0.5) {
          if (motionState.lastKneeY > 0 &&
              Math.abs(leftKnee.y - motionState.lastKneeY) > kneeSensitivity) {
            motionDetected = true;
          }
          motionState.lastKneeY = leftKnee.y;
        } else if (rightKnee && rightKnee.score && rightKnee.score > 0.5) {
          if (motionState.lastKneeY > 0 &&
              Math.abs(rightKnee.y - motionState.lastKneeY) > kneeSensitivity) {
            motionDetected = true;
          }
          motionState.lastKneeY = rightKnee.y;
        }

        if (leftElbow && leftElbow.score && leftElbow.score > 0.5) {
          if (motionState.lastElbowY > 0 &&
              Math.abs(leftElbow.y - motionState.lastElbowY) > elbowSensitivity) {
            motionDetected = true;
          }
          motionState.lastElbowY = leftElbow.y;
        } else if (rightElbow && rightElbow.score && rightElbow.score > 0.5) {
          if (motionState.lastElbowY > 0 &&
              Math.abs(rightElbow.y - motionState.lastElbowY) > elbowSensitivity) {
            motionDetected = true;
          }
          motionState.lastElbowY = rightElbow.y;
        }

        if (motionDetected) {
          motionState.motionCount++;
          if (motionState.lastMotionTime > 0) {
            const timeDiff = currentTime - motionState.lastMotionTime;
            const instantFreq = 1000 / timeDiff;
            motionState.motionFrequency = 0.7 * motionState.motionFrequency + 0.3 * instantFreq;
          }
          motionState.lastMotionTime = currentTime;
          setMotionFrequencies(prev => {
            const newFreqs = [...prev];
            newFreqs[playerIndex] = motionState.motionFrequency;
            return newFreqs;
          });
        } else if (currentTime - motionState.lastMotionTime > 1000) {
          motionState.motionFrequency *= 0.9;
          setMotionFrequencies(prev => {
            const newFreqs = [...prev];
            newFreqs[playerIndex] = motionState.motionFrequency;
            return newFreqs;
          });
        }

        return motionDetected;
      };

      const detectLoop = async () => {
        if (!isMounted || !detectorRef.current) return;

        // 摄像头画面和UI绘制
        const videoCanvas = videoCanvasRef.current;
        if (videoCanvas && showCamera) {
          const ctx = videoCanvas.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.translate(videoCanvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
            ctx.restore();

            ctx.beginPath();
            ctx.moveTo(videoCanvas.width / 2, 0);
            ctx.lineTo(videoCanvas.width / 2, videoCanvas.height);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
// 可视化分界线
ctx.save();
ctx.strokeStyle = 'red';
ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(videoCanvas.width / 2, 0);
ctx.lineTo(videoCanvas.width / 2, videoCanvas.height);
ctx.stroke();
ctx.restore();

// 区域文字提示
ctx.font = 'bold 22px Arial';
ctx.fillStyle = players[0].color;
ctx.textAlign = 'left';
ctx.fillText('玩家1区域', 20, 40);
ctx.fillStyle = players[1].color;
ctx.textAlign = 'right';
ctx.fillText('玩家2区域', videoCanvas.width - 20, 40);

            ctx.font = '24px "Bubblegum Sans", cursive';
            ctx.lineWidth = 4;
            ctx.fillStyle = players[0].color;
            ctx.strokeStyle = 'white';
            ctx.strokeText('玩家1区域', videoCanvas.width / 4 - 50, 30);
            ctx.fillText('玩家1区域', videoCanvas.width / 4 - 50, 30);
            ctx.fillStyle = players[1].color;
            ctx.strokeStyle = 'white';
            ctx.strokeText('玩家2区域', videoCanvas.width * 3 / 4 - 50, 30);
            ctx.fillText('玩家2区域', videoCanvas.width * 3 / 4 - 50, 30);

            ctx.font = '18px "Comic Neue", cursive';
            ctx.fillStyle = '#ffeb3b';
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 3;
            ctx.strokeText(`动作频率: ${motionFrequencies[0].toFixed(1)}次/秒`, videoCanvas.width / 4 - 50, 60);
            ctx.fillText(`动作频率: ${motionFrequencies[0].toFixed(1)}次/秒`, videoCanvas.width / 4 - 50, 60);
            ctx.strokeText(`动作频率: ${motionFrequencies[1].toFixed(1)}次/秒`, videoCanvas.width * 3 / 4 - 50, 60);
            ctx.fillText(`动作频率: ${motionFrequencies[1].toFixed(1)}次/秒`, videoCanvas.width * 3 / 4 - 50, 60);
          }
        }

        // TensorFlow.js MoveNet真实检测
        const poses: any[] = await detectorRef.current.estimatePoses(video);
        // 调试输出所有检测到的pose鼻子x坐标
        if (poses && poses.length > 0) {
          console.log('所有pose鼻子x坐标:', poses.map((p: any) => p.keypoints && p.keypoints[0] && p.keypoints[0].x));
        }

        if (poses && poses.length > 0) {
          // 区域分配：左半区域分配给玩家1，右半区域分配给玩家2
          const width = video.width;
          let found = [false, false];
          poses.forEach((pose: any) => {
            if (!pose.keypoints || typeof pose.keypoints[0].x !== 'number') return;
            const x = pose.keypoints[0].x;
            // 注意：摄像头画面做了镜像，视觉左侧x较大，右侧x较小
            if (x > width / 2 && !found[0]) {
              detectRunningMotion(pose.keypoints, 0); // 视觉左侧，玩家1
              found[0] = true;
            } else if (x <= width / 2 && !found[1]) {
              detectRunningMotion(pose.keypoints, 1); // 视觉右侧，玩家2
              found[1] = true;
            }
          });
        } else {
          playerMotions.current.forEach((motion, index) => {
            motion.motionFrequency *= 0.9;
            setMotionFrequencies(prev => {
              const newFreqs = [...prev];
              newFreqs[index] = motion.motionFrequency;
              return newFreqs;
            });
          });
        }
        animationIdRef.current = requestAnimationFrame(detectLoop);
      };

      await setupCamera();
      await initDetector();
      detectLoop();
    };

    init();

    return () => {
      isMounted = false;
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (detectorRef.current && detectorRef.current.dispose) detectorRef.current.dispose();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      video.remove();
    };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const background = useRef(new Image());
  const boatImages = useRef([new Image(), new Image()]);

  // 粽子配饰动画参数
  const zongziCount = 8;
  const zongziBase = Array.from({ length: zongziCount }).map((_, i) => ({
    x: i % 2 === 0 ? 80 : CANVAS_WIDTH - 80,
    y: 200 + i * 180,
    offset: Math.random() * Math.PI * 2,
    side: i % 2 === 0 ? 'left' : 'right'
  }));
  const zongziImg = useRef<HTMLImageElement | null>(null);
  if (!zongziImg.current) {
    zongziImg.current = new window.Image();
    // 如有 zongzi.png 则用，否则用 emoji 绘制
    zongziImg.current.src = "/zongzi.png";
  }

  useEffect(() => {
    background.current.src = "/my-background.png";
    boatImages.current[0].src = "/dragonboat1.png";
    boatImages.current[1].src = "/dragonboat2.png";
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      if (!background.current.complete || !boatImages.current[0].complete) {
        requestAnimationFrame(draw);
        return;
      }

      const currentPlayers = playersRef.current;
      const currentGameStatus = gameStatusRef.current;

      if (currentGameStatus === 'finished') {
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(background.current, 0, 0, canvas.width, canvas.height);

      // 动态粽子配饰
      const now = Date.now() / 800;
      zongziBase.forEach((z, idx) => {
        // 上下浮动动画
        const floatY = z.y + Math.sin(now + z.offset) * 24;
        if (zongziImg.current && zongziImg.current.complete && zongziImg.current.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.drawImage(zongziImg.current, z.x - 32, floatY - 32, 64, 64);
          ctx.restore();
        } else {
          // 无图片时用绿色三角形代替
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(z.x, floatY - 24);
          ctx.lineTo(z.x - 24, floatY + 24);
          ctx.lineTo(z.x + 24, floatY + 24);
          ctx.closePath();
          ctx.fillStyle = "#4caf50";
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.restore();
        }
      });

      currentPlayers.forEach((player, idx) => {
        ctx.drawImage(boatImages.current[idx], player.x - BOAT_WIDTH / 2, player.y, BOAT_WIDTH, BOAT_HEIGHT);
      });

      currentPlayers.forEach((player, idx) => {
        ctx.font = '20px "Bangers", cursive';
        ctx.fillStyle = "#333";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeText(player.name, player.x - 20, player.y - 60);
        ctx.fillText(player.name, player.x - 20, player.y - 60);

        ctx.font = '20px "Bubblegum Sans", cursive';
        ctx.fillStyle = player.color;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeText(`分数: ${player.score}`, player.x - 20, player.y - 40);
        ctx.fillText(`分数: ${player.score}`, player.x - 20, player.y - 40);
      });

      requestAnimationFrame(draw);
    };

    draw();

    return () => {
      // Stop any ongoing draw loops if needed
    };
  }, []);

  useEffect(() => {
    if (gameStatus === "countdown") {
      const countdownInterval = setInterval(() => {
        setCountdown((prevCountdown) => prevCountdown - 1);
      }, 1000);

      setTimeout(() => {
        setGameStatus("playing");
        setCountdown(3);
        clearInterval(countdownInterval);
      }, 3000);

      return () => {
        clearInterval(countdownInterval);
      };
    }
  }, [gameStatus]);

  useEffect(() => {
    if (gameStatus === "playing" && !gameInterval) {
      const interval = setInterval(() => {
        setPlayers((prevPlayers) => {
          const newPlayers = prevPlayers.map((player, index) => {
            const motionFreq = playerMotions.current[index].motionFrequency;
            const moveSpeed = Math.min(motionFreq * 2, 15);
            const newY = motionFreq > 0.1 ? Math.max(player.y - moveSpeed, 0) : player.y;
            const distance = player.y - newY;
            const scoreIncrement = Math.floor(distance * 0.1);
            return {
              ...player,
              y: newY,
              score: player.score + scoreIncrement
            };
          });

          const finishedPlayers = newPlayers.filter((player) => player.y <= 0);
          if (finishedPlayers.length > 0) {
            setGameStatus("finished");
            setWinner(finishedPlayers[0].name);
            setShowVictoryModal(true);
            clearInterval(interval);
          }
          return newPlayers;
        });
      }, 100);
      setGameInterval(interval);
    } else if (gameStatus !== "playing" && gameInterval) {
      clearInterval(gameInterval);
      setGameInterval(null);
    }
  }, [gameStatus, gameInterval, players]);

  return (
    <div style={{
      background: "linear-gradient(180deg, #fff8e1 60%, #e0f7fa 100%)",
      padding: "32px",
      border: "8px solid #ffcc80",
      borderRadius: "24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.10)",
      position: "relative"
    }}>
      {/* 开始游戏按钮，仅在 ready 或 finished 状态下显示 */}
      {(gameStatus === "ready" || gameStatus === "finished") && (
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <button
            style={{
              fontSize: "30px",
              padding: "16px 48px",
              background: "linear-gradient(90deg, #ff9800 60%, #ffd54f 100%)",
              color: "#fff",
              border: "none",
              borderRadius: "18px",
              fontWeight: "bold",
              boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
              cursor: "pointer",
              letterSpacing: "2px",
              margin: "0 8px",
              transition: "background 0.2s"
            }}
            onClick={() => {
              setPlayers([
                { x: CANVAS_WIDTH * 0.25, y: CANVAS_HEIGHT - 100, color: "#ff5722", name: "玩家1", score: 0 },
                { x: CANVAS_WIDTH * 0.75, y: CANVAS_HEIGHT - 100, color: "#3f51b5", name: "玩家2", score: 0 },
              ]);
              // 重置动作状态
              playerMotions.current = [
                { lastKneeY: 0, lastElbowY: 0, motionCount: 0, lastMotionTime: 0, motionFrequency: 0 },
                { lastKneeY: 0, lastElbowY: 0, motionCount: 0, lastMotionTime: 0, motionFrequency: 0 },
              ];
              setMotionFrequencies([0, 0]);
              setWinner(null);
              setShowVictoryModal(false);
              setGameStatus("countdown");
            }}
          >
            {gameStatus === "finished" ? "再来一局" : "开始游戏"}
          </button>
        </div>
      )}
      {/* 倒计时动画层 */}
      {gameStatus === "countdown" && (
        <div
          style={{
            position: "absolute",
            zIndex: 1000,
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column"
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: countdown > 0 ? 140 : 110,
              fontWeight: "bold",
              textShadow: "0 0 40px #43a047, 0 0 20px #fff",
              letterSpacing: "8px",
              transition: "all 0.3s cubic-bezier(.4,2,.6,1)"
            }}
          >
            {countdown > 0 ? countdown : "开始！"}
          </span>
          <div style={{
            marginTop: 40,
            fontSize: 32,
            color: "#43a047",
            fontWeight: "bold",
            letterSpacing: "4px",
            textShadow: "0 0 12px #fff"
          }}>
            端午安康！
          </div>
        </div>
      )}
      {/* 顶部分数显示区域 */}
      {/* 分数显示区域已移除 */}
{/* 赛道两侧五彩绳装饰，仅在比赛进行时显示 */}
      {(gameStatus === "countdown" || gameStatus === "playing") && (
        <svg
          width={CANVAS_WIDTH}
          height="36"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: 10
          }}
        >
          <polyline
            points={`0,18 100,6 200,30 300,6 400,30 500,6 600,30 700,6 800,30 900,6 1000,30 1100,6 1200,18`}
            fill="none"
            stroke="#e91e63"
            strokeWidth="3"
            opacity="0.7"
          />
          <polyline
            points={`0,24 100,12 200,36 300,12 400,36 500,12 600,36 700,12 800,36 900,12 1000,36 1100,12 1200,24`}
            fill="none"
            stroke="#43a047"
            strokeWidth="3"
            opacity="0.7"
          />
          <polyline
            points={`0,30 100,18 200,36 300,18 400,36 500,18 600,36 700,18 800,36 900,18 1000,36 1100,18 1200,30`}
            fill="none"
            stroke="#ffd600"
            strokeWidth="3"
            opacity="0.7"
          />
        </svg>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{
            border: "6px solid #ff9800"
          }}
        />
        {showCamera && (
          <div style={{
            marginLeft: '20px',
            background: "#ffffff",
            padding: "32px",
            border: "4px solid #3f51b5"
          }}>
            <div style={{ width: "100%", textAlign: "center", marginBottom: "12px" }}>
              <h3 className="cartoon-title" style={{ textAlign: "center", fontSize: "32px", margin: 0 }}>摄像头预览（双人识别区）</h3>
            </div>
            <canvas
              ref={videoCanvasRef}
              width={1600}
              height={1200}
              style={{
                border: "4px solid #3f51b5"
              }}
            />
            <div style={{
              marginTop: '15px',
              background: "#e8f5e9",
              padding: "12px",
              border: "4px solid #81c784"
            }}>
              <p className="cartoon-text" style={{ fontSize: "32px", fontWeight: "bold" }}>请玩家1站在左侧区域，玩家2站在右侧区域</p>
              <p className="cartoon-text" style={{ fontSize: "32px", fontWeight: "bold" }}>做跑步动作（抬腿、摆臂）来控制龙舟前进</p>
              <p className="cartoon-text" style={{ color: '#ff5722', fontWeight: 'bold', fontSize: "36px" }}>动作越快，龙舟前进越快！</p>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '15px',
                background: "#fff8e1",
                padding: "10px",
                border: "4px solid #ffcc80"
              }}>
                <div style={{ color: players[0].color, fontWeight: 'bold', fontSize: "32px" }}>
                  玩家1动作频率: {motionFrequencies[0].toFixed(1)} 次/秒
                </div>
                <div style={{ color: players[1].color, fontWeight: 'bold', fontSize: "32px" }}>
                  玩家2动作频率: {motionFrequencies[1].toFixed(1)} 次/秒
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 其他UI和胜利弹窗等可按需补充 */}
      {/* 获胜弹窗 */}
      {showVictoryModal && winner && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, width: "100vw", height: "100vh",
          background: "rgba(0,0,0,0.5)",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <div style={{
            background: "#fff",
            borderRadius: "18px",
            padding: "48px 60px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            textAlign: "center",
            minWidth: "320px"
          }}>
            <h2 style={{ color: "#ff9800", fontSize: 36, marginBottom: 32 }}>
              {winner}胜利！
            </h2>
            <button
              style={{
                fontSize: "24px",
                padding: "12px 40px",
                background: "#43a047",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontWeight: "bold",
                cursor: "pointer"
              }}
              onClick={() => {
                setPlayers([
                  { x: 400, y: 1700, color: "#ff5722", name: "玩家1", score: 0 },
                  { x: 800, y: 1700, color: "#3f51b5", name: "玩家2", score: 0 },
                ]);
                setWinner(null);
                setShowVictoryModal(false);
                setGameStatus("countdown");
              }}
            >
              重新开始
            </button>
          </div>
        </div>
      )}
      {/* 赛道两侧五彩绳装饰 */}
      <svg width={CANVAS_WIDTH} height="60" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
        <polyline points={`0,30 100,10 200,50 300,10 400,50 500,10 600,50 700,10 800,50 900,10 1000,50 1100,10 1200,30`}
          fill="none" stroke="#e91e63" strokeWidth="6" />
        <polyline points={`0,40 100,20 200,60 300,20 400,60 500,20 600,60 700,20 800,60 900,20 1000,60 1100,20 1200,40`}
          fill="none" stroke="#43a047" strokeWidth="6" />
        <polyline points={`0,50 100,30 200,70 300,30 400,70 500,30 600,70 700,30 800,70 900,30 1000,70 1100,30 1200,50`}
          fill="none" stroke="#ffd600" strokeWidth="6" />
      </svg>
    </div>
  );
};

export default GameCanvas;
