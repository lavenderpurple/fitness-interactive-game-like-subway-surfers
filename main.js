// ==========================================
// 1. GLOBAL GAME STATE (The Bridge)
// ==========================================
const gameState = {
    isRunning: false,
    playerVisible: false,
    targetLaneX: 0, // -2 (Left), 0 (Center), 2 (Right)
    isJumping: false,
    isCrouching: false,
    
    // Vision math tracking
    lastShoulderY: 0,
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

        const leftShoulder = results.poseLandmarks[11];
        const rightShoulder = results.poseLandmarks[12];
        
        // --- 1. LANE DETECTION (X-Axis) ---
        // X goes from 0 (Left) to 1 (Right). But canvas is mirrored!
        const bodyCenterX = (leftShoulder.x + rightShoulder.x) / 2;
        if (bodyCenterX > 0.65) gameState.targetLaneX = -2;      // Move Left
        else if (bodyCenterX < 0.35) gameState.targetLaneX = 2;  // Move Right
        else gameState.targetLaneX = 0;                          // Center

        // --- 2. JUMP & CROUCH DETECTION (Absolute Y-Axis) ---
        const currentShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        
        // If shoulders are very high on screen (low Y value)
        if (currentShoulderY < 0.35) {
            gameState.isJumping = true;
            gameState.isCrouching = false;
            UI_ACTION.innerText = "JUMP!";
        } 
        // If shoulders drop very low (Squat)
        else if (currentShoulderY > 0.70) {
            gameState.isCrouching = true;
            gameState.isJumping = false;
            UI_ACTION.innerText = "DUCK!";
        } 
        else {
            gameState.isJumping = false;
            gameState.isCrouching = false;
            UI_ACTION.innerText = "";
        }

        // --- 3. LOCOMOTION (Relative Y-Axis Bobbing) ---
        if (gameState.lastShoulderY === 0) gameState.lastShoulderY = currentShoulderY;
        const deltaY = currentShoulderY - gameState.lastShoulderY;
        
        let currentDirection = gameState.movementDirection;
        const bounceThreshold = 0.008; 

        if (deltaY > bounceThreshold) currentDirection = 'down'; 
        else if (deltaY < -bounceThreshold) currentDirection = 'up';

        const currentTime = Date.now();
        // If we bounced up AND we aren't currently in a sustained crouch/jump
        if (currentDirection === 'up' && gameState.movementDirection === 'down' && !gameState.isJumping && !gameState.isCrouching) {
            if (currentTime - gameState.lastStepTime > 250) {
                gameState.lastStepTime = currentTime;
            }
        }

        gameState.movementDirection = currentDirection;
        gameState.lastShoulderY = currentShoulderY;

        if (currentTime - gameState.lastStepTime < 800) {
            gameState.isRunning = true;
        } else {
            gameState.isRunning = false;
        }

    } else {
        gameState.playerVisible = false;
        gameState.isRunning = false;
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

// Basic 3D Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background
scene.fog = new THREE.Fog(0x87CEEB, 10, 50);  // Fog to hide edge of the world

const camera3D = new THREE.PerspectiveCamera(75, 600 / 600, 0.1, 1000);
camera3D.position.set(0, 4, 6); // Position behind and slightly above player
camera3D.lookAt(0, 1, -5);      // Look down the track

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(600, 600);
container.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// The Ground (Grid to show movement)
const gridHelper = new THREE.GridHelper(100, 50, 0x000000, 0x444444);
gridHelper.position.y = 0;
scene.add(gridHelper);

// The Player (Currently a geometric block)
// A standard character is 2 units tall, 1 unit wide
const geometry = new THREE.BoxGeometry(1, 2, 1); 
const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
const playerMesh = new THREE.Mesh(geometry, material);
playerMesh.position.y = 1; // Half height so feet touch the ground
scene.add(playerMesh);

// 3D Animation Loop
function animate() {
    requestAnimationFrame(animate);

    // 1. UI Updates
    if (!gameState.playerVisible) {
        UI_STATUS.innerText = "PAUSED: PLAYER NOT IN VIEW";
        UI_STATUS.style.color = "#ffaa00";
    } else if (gameState.isRunning) {
        UI_STATUS.innerText = "RUNNING!";
        UI_STATUS.style.color = "#00ffcc";
    } else {
        UI_STATUS.innerText = "IDLE - JOG TO MOVE";
        UI_STATUS.style.color = "#ff3333";
    }

    // 2. Execute 3D Movement
    if (gameState.isRunning) {
        // "Treadmill Effect" - scroll the grid towards the camera to simulate running
        gridHelper.position.z += 0.2; 
        if (gridHelper.position.z > 2) gridHelper.position.z = 0; // Loop the grid
    }

    // 3. Lane Switching (Smooth interpolation towards target X)
    playerMesh.position.x += (gameState.targetLaneX - playerMesh.position.x) * 0.1;

    // 4. Jumping & Crouching Physics Simulation
    if (gameState.isJumping) {
        // Vault into the air
        playerMesh.position.y += (3.5 - playerMesh.position.y) * 0.15; 
        playerMesh.scale.y = 1; // Ensure normal height
    } else if (gameState.isCrouching) {
        // Squash down, move Y down so it stays on the floor
        playerMesh.scale.y = 0.4; 
        playerMesh.position.y = 0.4; 
    } else {
        // Normal running state
        playerMesh.scale.y = 1;
        // Add a slight bounce if running, otherwise return to floor
        const targetY = gameState.isRunning ? 1 + Math.abs(Math.sin(Date.now() / 150)) * 0.5 : 1;
        playerMesh.position.y += (targetY - playerMesh.position.y) * 0.2;
    }

    renderer.render(scene, camera3D);
}

// Start the 3D loop
animate();