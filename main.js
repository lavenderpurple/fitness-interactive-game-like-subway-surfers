// ==========================================
// 1. GLOBAL GAME STATE & CALIBRATION
// ==========================================
const gameState = {
    phase: 'CALIBRATION', // Starts in calibration mode
    calibrationTime: 0,
    baseX: 0,
    baseY: 0,

    isRunning: false,
    playerVisible: false,
    targetLaneX: 0, // -2 (Left), 0 (Center), 2 (Right)
    isJumping: false,
    isCrouching: false,
    
    lastNoseY: 0,
    movementDirection: 'none',
    lastStepTime: 0
};

const UI_STATUS = document.getElementById('status-text');
const UI_ACTION = document.getElementById('action-text');

// ==========================================
// 2. VISION ENGINE (MediaPipe)
// ==========================================
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.poseLandmarks && results.poseLandmarks.length > 0) {
        gameState.playerVisible = true;
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 1});

        // WE USE THE NOSE (Landmark 0) FOR CORE TRACKING
        const nose = results.poseLandmarks[0];
        const currentTime = Date.now();

        // ----------------------------------------------------
        // PHASE 1: CALIBRATION (Finding the Base Position)
        // ----------------------------------------------------
        if (gameState.phase === 'CALIBRATION') {
            // Define the "Target Box" in the center of the camera
            const boxLeft = 0.4, boxRight = 0.6;
            const boxTop = 0.3, boxBottom = 0.5;

            // Draw Target Box on Camera View
            canvasCtx.strokeStyle = '#FFFF00';
            canvasCtx.lineWidth = 4;
            canvasCtx.strokeRect(boxLeft * canvasElement.width, boxTop * canvasElement.height, 
                                 (boxRight - boxLeft) * canvasElement.width, (boxBottom - boxTop) * canvasElement.height);
            
            // Check if Nose is inside the box
            if (nose.x > boxLeft && nose.x < boxRight && nose.y > boxTop && nose.y < boxBottom) {
                gameState.calibrationTime += 30; // Roughly 30ms per frame
                
                // Visual feedback: fill box green as time passes
                const progress = Math.min(gameState.calibrationTime / 3000, 1);
                canvasCtx.fillStyle = `rgba(0, 255, 0, ${progress * 0.5})`;
                canvasCtx.fillRect(boxLeft * canvasElement.width, boxTop * canvasElement.height, 
                                 (boxRight - boxLeft) * canvasElement.width, (boxBottom - boxTop) * canvasElement.height);

                if (gameState.calibrationTime >= 3000) { // 3 seconds locked in
                    gameState.baseX = nose.x;
                    gameState.baseY = nose.y;
                    gameState.phase = 'PLAYING';
                    console.log(`Calibrated! BaseX: ${gameState.baseX}, BaseY: ${gameState.baseY}`);
                }
            } else {
                gameState.calibrationTime = 0; // Reset if they move out of the box
            }
        } 
        // ----------------------------------------------------
        // PHASE 2: PLAYING (Relative Tracking)
        // ----------------------------------------------------
        else if (gameState.phase === 'PLAYING') {
            
            // Draw Anchor Point on UI
            canvasCtx.fillStyle = '#00FFFF';
            canvasCtx.beginPath();
            canvasCtx.arc(gameState.baseX * canvasElement.width, gameState.baseY * canvasElement.height, 8, 0, 2 * Math.PI);
            canvasCtx.fill();

            // --- 1. LANE DETECTION (Relative to BaseX) ---
            const laneThreshold = 0.15; 
            if (nose.x > gameState.baseX + laneThreshold) gameState.targetLaneX = -2;      // Move Left
            else if (nose.x < gameState.baseX - laneThreshold) gameState.targetLaneX = 2;  // Move Right
            else gameState.targetLaneX = 0;                                                // Center

            // --- 2. JUMP & CROUCH DETECTION (Relative to BaseY) ---
            const jumpThreshold = 0.12;  // How far UP from base they must move
            const crouchThreshold = 0.15; // How far DOWN from base they must move
            
            if (nose.y < gameState.baseY - jumpThreshold) {
                gameState.isJumping = true;
                gameState.isCrouching = false;
                UI_ACTION.innerText = "JUMP!";
            } else if (nose.y > gameState.baseY + crouchThreshold) {
                gameState.isCrouching = true;
                gameState.isJumping = false;
                UI_ACTION.innerText = "DUCK!";
            } else {
                gameState.isJumping = false;
                gameState.isCrouching = false;
                UI_ACTION.innerText = "";
            }

            // --- 3. LOCOMOTION (Nose Bobbing) ---
            if (gameState.lastNoseY === 0) gameState.lastNoseY = nose.y;
            const deltaY = nose.y - gameState.lastNoseY;
            
            let currentDirection = gameState.movementDirection;
            const bounceThreshold = 0.006; // Adjusted for nose tracking

            if (deltaY > bounceThreshold) currentDirection = 'down'; 
            else if (deltaY < -bounceThreshold) currentDirection = 'up';

            // Detect Step (Only if not actively jumping/crouching)
            if (currentDirection === 'up' && gameState.movementDirection === 'down' && !gameState.isJumping && !gameState.isCrouching) {
                if (currentTime - gameState.lastStepTime > 250) {
                    gameState.lastStepTime = currentTime;
                }
            }

            gameState.movementDirection = currentDirection;
            gameState.lastNoseY = nose.y;

            if (currentTime - gameState.lastStepTime < 800) {
                gameState.isRunning = true;
            } else {
                gameState.isRunning = false;
            }
        }

    } else {
        gameState.playerVisible = false;
        gameState.isRunning = false;
        gameState.calibrationTime = 0; // Reset calibration if they leave frame
        canvasCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    }
    canvasCtx.restore();
}

const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose.onResults(onResults);

const camera = new Camera(videoElement, { onFrame: async () => { await pose.send({image: videoElement}); }, width: 480, height: 360 });
camera.start();

// ==========================================
// 3. 3D GAME ENGINE (Three.js)
// ==========================================
const container = document.getElementById('game-container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); 
scene.fog = new THREE.Fog(0x87CEEB, 10, 50);  

const camera3D = new THREE.PerspectiveCamera(75, 600 / 600, 0.1, 1000);
camera3D.position.set(0, 4, 6); 
camera3D.lookAt(0, 1, -5);      

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(600, 600);
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(100, 50, 0x000000, 0x444444);
gridHelper.position.y = 0;
scene.add(gridHelper);

const geometry = new THREE.BoxGeometry(1, 2, 1); 
const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
const playerMesh = new THREE.Mesh(geometry, material);
playerMesh.position.y = 1; 
scene.add(playerMesh);

function animate() {
    requestAnimationFrame(animate);

    // 1. UI Updates
    if (!gameState.playerVisible) {
        UI_STATUS.innerText = "ERROR: NO PLAYER IN VIEW";
        UI_STATUS.style.color = "#ffaa00";
    } else if (gameState.phase === 'CALIBRATION') {
        UI_STATUS.innerText = "ALIGN FACE IN YELLOW BOX";
        UI_STATUS.style.color = "#ffff00";
    } else if (gameState.isRunning) {
        UI_STATUS.innerText = "RUNNING!";
        UI_STATUS.style.color = "#00ffcc";
    } else {
        UI_STATUS.innerText = "IDLE - JOG TO MOVE";
        UI_STATUS.style.color = "#ff3333";
    }

    // 2. Only move game if PLAYING
    if (gameState.phase === 'PLAYING') {
        if (gameState.isRunning) {
            gridHelper.position.z += 0.2; 
            if (gridHelper.position.z > 2) gridHelper.position.z = 0; 
        }

        playerMesh.position.x += (gameState.targetLaneX - playerMesh.position.x) * 0.1;

        if (gameState.isJumping) {
            playerMesh.position.y += (3.5 - playerMesh.position.y) * 0.15; 
            playerMesh.scale.y = 1; 
        } else if (gameState.isCrouching) {
            playerMesh.scale.y = 0.4; 
            playerMesh.position.y = 0.4; 
        } else {
            playerMesh.scale.y = 1;
            const targetY = gameState.isRunning ? 1 + Math.abs(Math.sin(Date.now() / 150)) * 0.5 : 1;
            playerMesh.position.y += (targetY - playerMesh.position.y) * 0.2;
        }
    }

    renderer.render(scene, camera3D);
}
animate();