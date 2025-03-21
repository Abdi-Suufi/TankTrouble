const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const gameState = {
  tanks: {},
  bullets: [],
  walls: []
};

// Initialize walls
function initializeWalls() {
  const gameWidth = 800;
  const gameHeight = 600;
  
  // Border walls
  gameState.walls.push({x: 0, y: 0, width: gameWidth, height: 20}); // Top
  gameState.walls.push({x: 0, y: gameHeight - 20, width: gameWidth, height: 20}); // Bottom
  gameState.walls.push({x: 0, y: 0, width: 20, height: gameHeight}); // Left
  gameState.walls.push({x: gameWidth - 20, y: 0, width: 20, height: gameHeight}); // Right
  
  // Center obstacles - same as in your original game
  gameState.walls.push({x: 200, y: 150, width: 150, height: 20});
  gameState.walls.push({x: 450, y: 150, width: 150, height: 20});
  gameState.walls.push({x: 200, y: 430, width: 150, height: 20});
  gameState.walls.push({x: 450, y: 430, width: 150, height: 20});
  
  // Vertical obstacles
  gameState.walls.push({x: 200, y: 170, width: 20, height: 100});
  gameState.walls.push({x: 580, y: 170, width: 20, height: 100});
  gameState.walls.push({x: 200, y: 330, width: 20, height: 100});
  gameState.walls.push({x: 580, y: 330, width: 20, height: 100});
  
  // Middle obstacle
  gameState.walls.push({x: 350, y: 250, width: 100, height: 100});
}

// Initialize game
initializeWalls();

// Tank properties
const tankWidth = 30;
const tankHeight = 40;
const tankSpeed = 3;
const rotationSpeed = 3 * Math.PI / 180;

// Bullet properties
const bulletSpeed = 5;
const bulletRadius = 3;
const bulletLifetime = 180;
const bulletCooldown = 30;

// Helper functions
function canMoveToPosition(tank, newX, newY) {
  const tankRect = {
    x: newX - tankWidth / 2,
    y: newY - tankHeight / 2,
    width: tankWidth,
    height: tankHeight
  };
  
  for (const wall of gameState.walls) {
    if (checkCollision(tankRect, wall)) {
      return false;
    }
  }
  
  return true;
}

function checkCollision(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

function pointInRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

// Socket connection
io.on('connection', (socket) => {
  console.log('New player connected:', socket.id);
  
  // Create a new tank for the player
  const colors = ['#ffcc00', '#3399ff', '#ff3366', '#33cc33', '#9933ff'];
  const colorIndex = Object.keys(gameState.tanks).length % colors.length;
  
  // Assign spawn positions based on player count
  let spawnX, spawnY, spawnAngle;
  switch (Object.keys(gameState.tanks).length % 4) {
    case 0:
      spawnX = 100;
      spawnY = 100;
      spawnAngle = 0;
      break;
    case 1:
      spawnX = 700;
      spawnY = 500;
      spawnAngle = Math.PI;
      break;
    case 2:
      spawnX = 700;
      spawnY = 100;
      spawnAngle = Math.PI * 1.5;
      break;
    case 3:
      spawnX = 100;
      spawnY = 500;
      spawnAngle = Math.PI * 0.5;
      break;
  }
  
  // Create new tank
  gameState.tanks[socket.id] = {
    id: socket.id,
    x: spawnX,
    y: spawnY,
    width: tankWidth,
    height: tankHeight,
    angle: spawnAngle,
    color: colors[colorIndex],
    cooldown: 0,
    score: 0,
    inputs: {
      up: false,
      down: false,
      left: false,
      right: false,
      fire: false
    }
  };
  
  // Send initial game state to the new player
  socket.emit('gameInit', {
    id: socket.id,
    gameState: gameState
  });
  
  // Broadcast new player to all other players
  socket.broadcast.emit('playerJoined', {
    id: socket.id,
    tank: gameState.tanks[socket.id]
  });
  
  // Handle player inputs
  socket.on('playerInput', (data) => {
    if (gameState.tanks[socket.id]) {
      gameState.tanks[socket.id].inputs = data;
    }
  });
  
  // Handle player disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete gameState.tanks[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

// Game loop
const FPS = 60;
setInterval(() => {
  // Update tank positions
  Object.values(gameState.tanks).forEach(tank => {
    // Handle movement
    if (tank.inputs.up) {
      const newX = tank.x + Math.sin(tank.angle) * tankSpeed;
      const newY = tank.y - Math.cos(tank.angle) * tankSpeed;
      
      if (canMoveToPosition(tank, newX, newY)) {
        tank.x = newX;
        tank.y = newY;
      }
    }
    
    if (tank.inputs.down) {
      const newX = tank.x - Math.sin(tank.angle) * tankSpeed;
      const newY = tank.y + Math.cos(tank.angle) * tankSpeed;
      
      if (canMoveToPosition(tank, newX, newY)) {
        tank.x = newX;
        tank.y = newY;
      }
    }
    
    if (tank.inputs.left) {
      tank.angle -= rotationSpeed;
    }
    
    if (tank.inputs.right) {
      tank.angle += rotationSpeed;
    }
    
    // Handle firing
    if (tank.inputs.fire && tank.cooldown === 0) {
      const bulletX = tank.x + Math.sin(tank.angle) * (tankHeight / 2);
      const bulletY = tank.y - Math.cos(tank.angle) * (tankHeight / 2);
      
      gameState.bullets.push({
        x: bulletX,
        y: bulletY,
        angle: tank.angle,
        life: bulletLifetime,
        color: tank.color,
        owner: tank.id
      });
      
      tank.cooldown = bulletCooldown;
    }
    
    if (tank.cooldown > 0) {
      tank.cooldown--;
    }
  });
  
  // Update bullets - create a copy of the bullets array to safely modify
  const bullets = [...gameState.bullets];
  gameState.bullets = [];
  
  for (let i = 0; i < bullets.length; i++) {
    const bullet = bullets[i];
    
    if (!bullet) continue; // Skip if bullet is undefined
    
    // Update bullet position
    const newBulletX = bullet.x + Math.sin(bullet.angle) * bulletSpeed;
    const newBulletY = bullet.y - Math.cos(bullet.angle) * bulletSpeed;
    bullet.x = newBulletX;
    bullet.y = newBulletY;
    bullet.life--;
    
    // Check collision with walls
    let collided = false;
    for (const wall of gameState.walls) {
      if (pointInRect(bullet.x, bullet.y, wall)) {
        collided = true;
        break;
      }
    }
    
    // Check collision with tanks
    for (const [id, tank] of Object.entries(gameState.tanks)) {
      if (bullet.owner !== id) { // Don't collide with owner
        const tankRect = {
          x: tank.x - tank.width / 2,
          y: tank.y - tank.height / 2,
          width: tank.width,
          height: tank.height
        };
        
        if (pointInRect(bullet.x, bullet.y, tankRect)) {
          // Tank hit
          if (gameState.tanks[bullet.owner]) {
            gameState.tanks[bullet.owner].score++;
          }
          
          // Reset tank position
          tank.x = 100 + Math.random() * 600;
          tank.y = 100 + Math.random() * 400;
          
          // Find a valid spawn position
          let validPosition = false;
          let attempts = 0;
          while (!validPosition && attempts < 10) {
            tank.x = 100 + Math.random() * 600;
            tank.y = 100 + Math.random() * 400;
            validPosition = canMoveToPosition(tank, tank.x, tank.y);
            attempts++;
          }
          
          // If couldn't find a position after 10 attempts, use a fixed position
          if (!validPosition) {
            tank.x = 400;
            tank.y = 300;
          }
          
          // Clear bullets (safely)
          gameState.bullets = [];
          collided = true;
          break;
        }
      }
    }
    
    // Keep bullet if it hasn't collided or expired
    if (!collided && bullet.life > 0) {
      gameState.bullets.push(bullet);
    }
  }
  
  // Send updated game state to all players
  io.emit('gameUpdate', gameState);
}, 1000 / FPS);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});