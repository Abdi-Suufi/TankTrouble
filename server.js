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

// Available tank colors
const availableColors = ['#ffcc00', '#3399ff', '#ff3366', '#33cc33', '#9933ff', '#ff6600', '#66ccff', '#cc66ff'];

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
const bulletMaxBounces = 3; // Maximum number of bounces before bullet disappears
const bulletOffset = bulletRadius + 2; // Offset to avoid bullet getting stuck in walls

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

// Improved collision detection for bullets using a circle vs rectangle
function bulletCollidesWith(bullet, rect) {
  // Find the closest point in the rectangle to the circle
  const closestX = Math.max(rect.x, Math.min(bullet.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(bullet.y, rect.y + rect.height));
  
  // Calculate distance between the circle's center and the closest point
  const distX = bullet.x - closestX;
  const distY = bullet.y - closestY;
  
  // If the distance is less than the circle's radius, there's a collision
  return (distX * distX + distY * distY) <= (bulletRadius * bulletRadius);
}

// Improved wall collision detection for bullets
function checkBulletWallCollision(bullet) {
  for (const wall of gameState.walls) {
    if (bulletCollidesWith(bullet, wall)) {
      return wall;
    }
  }
  return null;
}

// Get collision normal for wall bounce
function getCollisionNormal(bullet, wall) {
  // Calculate bullet's previous position
  const prevX = bullet.x - Math.sin(bullet.angle) * bulletSpeed;
  const prevY = bullet.y - Math.cos(bullet.angle) * bulletSpeed;

  // Check which wall edge was hit
  const hitTop = prevY <= wall.y && bullet.y >= wall.y;
  const hitBottom = prevY >= wall.y + wall.height && bullet.y <= wall.y + wall.height;
  const hitLeft = prevX <= wall.x && bullet.x >= wall.x;
  const hitRight = prevX >= wall.x + wall.width && bullet.x <= wall.x + wall.width;

  if (hitTop || hitBottom) {
      return { nx: 0, ny: hitTop ? -1 : 1 }; // Reflect vertically
  }
  if (hitLeft || hitRight) {
      return { nx: hitLeft ? -1 : 1, ny: 0 }; // Reflect horizontally
  }

  return { nx: 0, ny: 0 }; // No collision detected (fallback)
}

// Socket connection
io.on('connection', (socket) => {
  console.log('New player connected:', socket.id);
  
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
  
  // Send available colors to the client
  socket.emit('availableColors', availableColors);
  
  // Handle player join with color choice
  socket.on('playerJoin', (data) => {
    // Create new tank with player's chosen color
    gameState.tanks[socket.id] = {
      id: socket.id,
      x: spawnX,
      y: spawnY,
      width: tankWidth,
      height: tankHeight,
      angle: spawnAngle,
      color: data.color || availableColors[0], // Default to first color if none chosen
      name: data.name || 'Player',
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
        owner: tank.id,
        bounceCount: 0, // Track number of bounces
        canHitOwner: false // Initially can't hit owner, set to true after first bounce
      });
      
      tank.cooldown = bulletCooldown;
    }
    
    if (tank.cooldown > 0) {
      tank.cooldown--;
    }
  });
  
  // Update bullets
  const updatedBullets = [];
  
  for (const bullet of gameState.bullets) {
    // Skip expired bullets
    if (bullet.life <= 0) {
      continue;
    }
    
    // Calculate new position
    const newBulletX = bullet.x + Math.sin(bullet.angle) * bulletSpeed;
    const newBulletY = bullet.y - Math.cos(bullet.angle) * bulletSpeed;
    
    // Save old position before updating
    const oldX = bullet.x;
    const oldY = bullet.y;
    
    // Update bullet position
    bullet.x = newBulletX;
    bullet.y = newBulletY;
    bullet.life--;
    
    // Check for collisions with walls
    const hitWall = checkBulletWallCollision(bullet);
    
    if (hitWall && bullet.bounceCount < bulletMaxBounces) {
      // Get collision normal
      const normal = getCollisionNormal(bullet, hitWall);
      
      // Reflect bullet angle based on normal
      if (normal.nx !== 0) { // Horizontal normal (vertical wall)
        bullet.angle = Math.PI - bullet.angle;
      } else { // Vertical normal (horizontal wall)
        bullet.angle = -bullet.angle;
      }
      
      // Normalize angle to [0, 2π)
      bullet.angle = (bullet.angle + 2 * Math.PI) % (2 * Math.PI);
      
      // Move bullet away from wall to prevent getting stuck
      bullet.x = oldX; // Restore old position first
      bullet.y = oldY;
      
      // Then move in new direction with offset
      bullet.x += Math.sin(bullet.angle) * (bulletSpeed + bulletOffset);
      bullet.y -= Math.cos(bullet.angle) * (bulletSpeed + bulletOffset);
      
      bullet.bounceCount++;
      bullet.canHitOwner = true; // After bounce, bullet can hit its owner
      
      // Continue to next bullet, skipping tank collision check
      updatedBullets.push(bullet);
      continue;
    }
    
    // Skip further checks if the bullet hit wall but couldn't bounce
    if (hitWall) {
      continue;
    }
    
    // Check collision with tanks
    let tankHit = false;
    for (const [id, tank] of Object.entries(gameState.tanks)) {
      // Skip owner check if the bullet can't hit owner yet
      if (bullet.owner === id && !bullet.canHitOwner) {
        continue;
      }
      
      const tankRect = {
        x: tank.x - tank.width / 2,
        y: tank.y - tank.height / 2,
        width: tank.width,
        height: tank.height
      };
      
      if (bulletCollidesWith(bullet, tankRect)) {
        // Tank hit
        if (gameState.tanks[bullet.owner] && bullet.owner !== id) {
          gameState.tanks[bullet.owner].score++;
        }
        
        // Reset tank position
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
        
        tankHit = true;
        break;
      }
    }
    
    // Keep bullet if it hasn't hit anything and hasn't expired
    if (!tankHit && !hitWall && bullet.life > 0) {
      updatedBullets.push(bullet);
    }
  }
  
  // Update the gameState with the filtered bullets
  gameState.bullets = updatedBullets;
  
  // Send updated game state to all players
  io.emit('gameUpdate', gameState);
}, 1000 / FPS);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});