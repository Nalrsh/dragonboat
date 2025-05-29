import React, { useEffect, useRef, useState } from "react";
/* 移除 mediapipe/pose 的 npm 包导入，改用 script 标签动态加载 */
import GameCanvas from "./GameCanvas";

type GameStatus = "ready" | "countdown" | "playing" | "finished";

interface PlayerState {
  x: number;
  y: number;
  color: string;
  name: string;
  score: number;
}

const poseOptions = {
  locateFile: (file: string) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
};

const GAME_LENGTH = 1200;
const PLAYER_Y_START = 440;
const PLAYER_Y_END = 60;

const HomePage: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<any>(null);
  const rafIdRef = useRef<number>();
  const poseRef = useRef<any>(null);

  const [gameStatus, setGameStatus] = useState<GameStatus>("ready");
  const [countdown, setCountdown] = useState(3);
  const [player, setPlayer] = useState<PlayerState>({
    x: 0,
    y: PLAYER_Y_START,
    color: "#ff5722",
    name: "玩家1",
    score: 0,
  });
  const [items, setItems] = useState<
    { x: number; y: number; type: "zongzi" | "boost" | "obstacle" }[]
  >([]);
  const [winner, setWinner] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    let cameraScript: HTMLScriptElement | null = null;
    let poseScript: HTMLScriptElement | null = null;
    let checkInterval: NodeJS.Timeout | null = null;

    function loadCameraAndPoseUtils() {
      try {
        if (typeof window !== "undefined" && !(window as any).Camera) {
          cameraScript = document.createElement("script");
          cameraScript.src = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
          cameraScript.async = true;
          cameraScript.onload = () => {
            console.log("Camera Utils 加载成功");
            setCameraReady(true);
          };
          cameraScript.onerror = (e) => {
            console.error("Camera Utils 加载失败:", e);
          };
          document.body.appendChild(cameraScript);
        } else if (typeof window !== "undefined") {
          setCameraReady(true);
        }

        if (typeof window !== "undefined" && !(window as any).Pose) {
          poseScript = document.createElement("script");
          poseScript.src = "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js";
          poseScript.async = true;
          poseScript.onload = () => {
            console.log("Pose 加载成功");
            setPoseReady(true);
          };
          poseScript.onerror = (e) => {
            console.error("Pose 加载失败:", e);
          };
          document.body.appendChild(poseScript);
        } else if (typeof window !== "undefined") {
          setPoseReady(true);
        }
      } catch (error) {
        console.error("加载 MediaPipe 工具时出错:", error);
      }
    }

    function tryInit() {
      try {
        if (
          typeof window !== "undefined" &&
          videoRef.current &&
          (window as any).Camera &&
          (window as any).Pose &&
          !poseRef.current
        ) {
          console.log("开始初始化 MediaPipe Pose");
          
          const PoseConstructor = (window as any).Pose;
          const poseInstance = new PoseConstructor(poseOptions);
          poseRef.current = poseInstance;
          
          poseInstance.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

          poseInstance.onResults((results: any) => {
            try {
              setPoseReady(true);
              let landmarksList: any[] =
                (results as any).poseLandmarksList ||
                (results.poseLandmarks ? [results.poseLandmarks] : []);
              setPlayerCount(landmarksList.length);
              if (landmarksList.length >= 1) {
                const playerLandmarks = landmarksList[0];
                // TODO: Use this to update the player's state
              }
            } catch (error) {
              console.error("处理姿态结果时出错:", error);
            }
          });

          console.log("初始化摄像头");
          cameraRef.current = new (window as any).Camera(videoRef.current, {
            onFrame: async () => {
              try {
                if (poseRef.current) {
                  await poseRef.current.send({ image: videoRef.current! });
                }
              } catch (error) {
                console.error("摄像头帧处理出错:", error);
              }
            },
            width: 640,
            height: 480,
          });
          
          console.log("启动摄像头");
          cameraRef.current.start();
        }
      } catch (error) {
        console.error("初始化 MediaPipe 时出错:", error);
      }
    }

    loadCameraAndPoseUtils();

    checkInterval = setInterval(() => {
      if ((window as any).Camera && (window as any).Pose) {
        tryInit();
        if (checkInterval) clearInterval(checkInterval);
      }
    }, 100);

    return () => {
      if (cameraRef.current) cameraRef.current.stop();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (checkInterval) clearInterval(checkInterval);
      if (cameraScript) document.body.removeChild(cameraScript);
      if (poseScript) document.body.removeChild(poseScript);
      if (poseRef.current) {
        if (poseRef.current.close) poseRef.current.close();
        poseRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (gameStatus === "countdown") {
      if (countdown > 0) {
        const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        setGameStatus("playing");
      }
    }
  }, [gameStatus, countdown]);

  useEffect(() => {
    if (gameStatus !== "playing") return;
    let rafId: number;
    const loop = () => {
      setPlayer((prev) => {
        let newY = prev.y - 2;
        if (newY < PLAYER_Y_END) newY = PLAYER_Y_END;
        return { ...prev, y: newY };
      });
      rafId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(rafId);
  }, [gameStatus]);

  useEffect(() => {
    if (gameStatus !== "playing") return;
    if (player.y <= PLAYER_Y_END && !winner) {
      setWinner(player.name);
      setGameStatus("finished");
    }
  }, [player.y, gameStatus, winner]);

  const handleStart = () => {
    setCountdown(3);
    setPlayer({
      x: 0,
      y: PLAYER_Y_START,
      color: "#ff5722",
      name: "玩家1",
      score: 0,
    });
    setWinner(null);
    setGameStatus("countdown");
  };

  return (
    <div className="cartoon-container" style={{
      display: "flex",
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "flex-start",
      minHeight: 520,
      padding: "20px",
      background: "#fff8e1"
    }}>
      <div style={{
        minWidth: 700,
        background: "#ffffff",
        padding: "20px",
        border: "4px solid #ffcc80"
      }}>
        <h1 className="cartoon-title" style={{
          fontSize: "32px",
          textAlign: "center",
          marginBottom: "20px",
          color: "#ff5722"
        }}>端午节双人龙舟竞速</h1>
        {gameStatus === "ready" && (
          <div style={{
            textAlign: "center",
            padding: "20px",
            background: "#fff8e1",
            border: "4px solid #ff9800"
          }}>
            <p className="cartoon-text">请两位玩家并排站在摄像头前，准备开始游戏！</p>
            <button className="cartoon-button" onClick={handleStart}>
              开始
            </button>
          </div>
        )}
        {gameStatus === "countdown" && (
          <div style={{
            textAlign: "center",
            padding: "30px",
            background: "#fff8e1",
            border: "4px solid #ff9800"
          }}>
            <h2 className="cartoon-title" style={{ fontSize: "48px" }}>倒计时：{countdown}</h2>
          </div>
        )}
        {(gameStatus === "playing" || gameStatus === "finished") && (
          <div style={{
            padding: "15px",
            background: "#fff8e1",
            border: "4px solid #81c784"
          }}>
            <GameCanvas player={player} items={items} gameLength={GAME_LENGTH} />
            <div style={{
              marginTop: 16,
              textAlign: "center",
              padding: "10px",
              background: "#c8e6c9",
              border: "3px solid #81c784"
            }}>
              <div style={{ display: "flex", justifyContent: "center", gap: "20px" }}>
                {/* 分数显示已移除 */}
              </div>
            </div>
          </div>
        )}
        {gameStatus === "finished" && (
          <div style={{
            textAlign: "center",
            padding: "20px",
            background: "#c8e6c9",
            border: "4px solid #43a047",
            marginTop: "15px"
          }}>
            <button className="cartoon-button" onClick={() => setGameStatus("ready")}>重新开始</button>
          </div>
        )}
      </div>
      <div style={{
        marginLeft: 32,
        minWidth: 320,
        background: "#e8f5e9",
        padding: 20,
        border: "4px solid #81c784"
      }}>
        <h3 className="cartoon-title" style={{ fontSize: "24px" }}>摄像头采集与识别</h3>
        <video
          ref={videoRef}
          width={300}
          height={225}
          style={{
            border: "4px solid #ff9800",
            background: "#222"
          }}
          autoPlay
          playsInline
        />
        <div style={{ margin: "12px 0" }}>
          <span className="cartoon-text">
            <span className="cartoon-label">摄像头状态</span>
            <b style={{ color: cameraReady ? "#43a047" : "#ff5722" }}>
              {cameraReady ? "已连接" : "未连接"}
            </b>
          </span>
          <br />
          <span className="cartoon-text">
            <span className="cartoon-label">姿态识别</span>
            <b style={{ color: poseReady ? "#43a047" : "#ff5722" }}>
              {poseReady ? "正常" : "未检测"}
            </b>
          </span>
          <br />
          <span className="cartoon-text">
            <span className="cartoon-label">检测到玩家数</span>
            <b style={{ color: playerCount >= 1 ? "#43a047" : "#ff9800" }}>
              {playerCount}
            </b>
          </span>
        </div>
        <div className="cartoon-text" style={{ fontSize: 13, color: "#ff9800" }}>
          若无法识别，请检查摄像头权限或刷新页面
        </div>
      </div>
    </div>
  );
};

export default HomePage;