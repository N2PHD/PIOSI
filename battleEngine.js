/**
 * battleEngine.js
 *
 * This version includes updated "yeet" logic so that if an enemy is knocked back
 * (yeeted) into the wall and cannot move past it, they take damage or die as intended.
 * It also applies damage if they collide with the wall during a yeet attempt.
 *
 * Additionally, we've integrated Mellitron's swarm ability.
 * Mellitron's swarm deals turn-based damage to any enemy in an adjacent tile.
 * The damage dealt is equal to Mellitron's current swarm stat.
 *
 * New in this version:
 * - Level objects functionality has been added.
 *   Instead of auto-generating a healing item, the battle engine now looks for level objects
 *   (such as a vittle) provided in the level configuration. For vittle objects, the default symbol
 *   is set to 'ౚ'. When a hero moves onto a cell containing a vittle, the hero consumes it and
 *   recovers a fixed amount of HP.
 *
 * For detailed guidelines on creating new levels, refer to the Level Creation Rubric in docs/level-creation.md.
 * 
 * Overview of Level Creation:
 * - Each level is defined by properties like `level`, `title`, `rows`, `cols`, `wallHP`, and `enemies`.
 * - Levels can use an `enemyGenerator` function to dynamically generate enemies.
 * - Special properties like `generateEnemies`, `waveNumber`, `restPhase`, and now `levelObjects`
 *   can be used for advanced level configurations.
 */

import { applyKnockback } from './applyKnockback.js';

export class BattleEngine {
  /**
   * @param {Array} party The heroes participating in battle.
   * @param {Array} enemies The enemies in this battle.
   * @param {number} fieldRows The number of rows in the battlefield.
   * @param {number} fieldCols The number of columns in the battlefield.
   * @param {number} wallHP The wall's hit points.
   * @param {Function} logCallback A function to log battle events.
   * @param {Function} onLevelComplete Callback when the level is complete.
   * @param {Function} onGameOver Callback when the game is over.
   * @param {Object} [levelConfig] Optional level configuration.
   *                   This can include:
   *                   - levelObjects: an array of objects (e.g., vittle) to be placed on the battlefield.
   */
  constructor(
    party,
    enemies,
    fieldRows,
    fieldCols,
    wallHP,
    logCallback,
    onLevelComplete,
    onGameOver,
    levelConfig = {}
  ) {
    // Filter out any heroes with 0 HP.
    this.party = party.filter(hero => hero.hp > 0);
    this.enemies = enemies;
    this.rows = fieldRows;
    this.cols = fieldCols;
    this.wallHP = wallHP;
    this.logCallback = logCallback;

    this.onLevelComplete = onLevelComplete;
    this.onGameOver = onGameOver;

    // Turn state properties.
    this.currentUnit = 0;
    this.movePoints = this.party.length ? this.party[0].agility : 0;
    this.awaitingAttackDirection = false;
    this.transitioningLevel = false;

    this.party.forEach(hero => {
      hero.statusEffects = hero.statusEffects || {};
    });
    this.enemies.forEach(enemy => {
      enemy.statusEffects = {};
    });

    // Level objects provided via the level configuration.
    // For now, level objects might include a healing item of type "vittle".
    this.levelObjects = levelConfig.levelObjects || [];
    // Compute a set of level object symbols for checking traversable cells.
    this.levelObjectSymbols = new Set(
      this.levelObjects.map(obj => {
        if (obj.type === 'vittle') {
          return obj.symbol || 'ౚ'; 
        }
        return obj.symbol || '?';
      })
    );

    this.battlefield = this.initializeBattlefield();
  }

  initializeBattlefield() {
    const field = Array.from({ length: this.rows }, () =>
      Array(this.cols).fill('.')
    );
    this.placeHeroes(field);
    this.placeEnemies(field);
    this.createWall(field);
    // Instead of auto-placing a healing item, we place level objects defined in the level configuration.
    this.placeLevelObjects(field);
    return field;
  }

  placeHeroes(field) {
    this.party.forEach((hero, index) => {
      hero.x = Math.min(index, this.cols - 1);
      hero.y = 0;
      field[hero.y][hero.x] = hero.symbol;
    });
  }

  placeEnemies(field) {
    this.enemies.forEach(enemy => {
      enemy.statusEffects = {};
      field[enemy.y][enemy.x] = enemy.symbol;
    });
  }

  createWall(field) {
    for (let i = 0; i < this.cols; i++) {
      field[this.rows - 1][i] = 'ᚙ';
    }
    this.enemies.forEach(enemy => {
      if (enemy.symbol === '█') {
        field[enemy.y][enemy.x] = enemy.symbol;
      }
    });
  }

  /**
   * Place level objects (such as a vittle) on the battlefield.
   * Each object in levelObjects should specify at least:
   * - type (e.g., "vittle")
   * - x and y coordinates.
   * Optionally, an object can define its own symbol.
   */
  placeLevelObjects(field) {
    this.levelObjects.forEach(obj => {
      if (
        obj.x >= 0 &&
        obj.x < this.cols &&
        obj.y >= 0 &&
        obj.y < this.rows - 1 && // exclude last row reserved for the wall
        field[obj.y][obj.x] === '.'
      ) {
        let symbol;
        if (obj.type === 'vittle') {
          symbol = obj.symbol || 'ౚ';
        } else {
          symbol = obj.symbol || '?';
        }
        field[obj.y][obj.x] = symbol;
      }
    });
  }

  drawBattlefield() {
    let html = '';
    for (let y = 0; y < this.rows; y++) {
      html += '<div class="row">';
      for (let x = 0; x < this.cols; x++) {
        const cellContent = this.battlefield[y][x];
        let cellClass = '';
        // Add class based on cell content.
        if (this.levelObjectSymbols.has(cellContent)) {
          // Add a specific class for level objects (ex: vittle)
          cellClass += ' level-object';
          // Optionally, you might add a sub-class if you wish to distinguish types.
          if (cellContent === 'ౚ') {
            cellClass += ' vittle';
          }
        }

        // Dynamically check if the cell content matches any enemy symbol.
        const isEnemy = this.enemies.some(
          enemy => enemy.symbol === cellContent
        );
        if (isEnemy) {
          cellClass += ' enemy';
        }

        if (
          this.party[this.currentUnit] &&
          this.party[this.currentUnit].x === x &&
          this.party[this.currentUnit].y === y
        ) {
          cellClass += this.awaitingAttackDirection
            ? ' attack-mode'
            : ' active';
        }
        html += `<div class="cell ${cellClass}">${cellContent}</div>`;
      }
      html += '</div>';
    }
    return html;
  }

  moveUnit(dx, dy) {
    if (
      this.awaitingAttackDirection ||
      this.movePoints <= 0 ||
      this.transitioningLevel
    )
      return;
    const unit = this.party[this.currentUnit];
    const newX = unit.x + dx;
    const newY = unit.y + dy;
    if (!this.isValidMove(newX, newY)) return;

    // Check if moving onto a level object (e.g., a vittle).
    if (this.levelObjectSymbols.has(this.battlefield[newY][newX])) {
      // For a vittle, we assume a fixed healing value.
      // In the future you can check for object type to change behavior.
      if (this.battlefield[newY][newX] === 'ౚ') {
        const healingValue = 10; // Fixed healing value for the vittle.
        unit.hp += healingValue;
        this.logCallback(
          `${unit.name} consumes a vittle and heals for ${healingValue} HP! (New HP: ${unit.hp})`
        );
      }
      // Remove the level object from the battlefield.
      this.battlefield[newY][newX] = '.';
    }

    // Update the battlefield.
    this.battlefield[unit.y][unit.x] = '.';
    unit.x = newX;
    unit.y = newY;
    this.battlefield[newY][newX] = unit.symbol;
    this.movePoints--;
    if (this.movePoints === 0) {
      this.nextTurn();
    }
  }

  // Allow movement onto empty cells or cells with level objects.
  isValidMove(x, y) {
    return (
      x >= 0 &&
      x < this.cols &&
      y >= 0 &&
      y < this.rows &&
      (this.battlefield[y][x] === '.' || this.levelObjectSymbols.has(this.battlefield[y][x]))
    );
  }

  async attackInDirection(dx, dy, unit, recordAttackCallback) {
    if (this.transitioningLevel) return;
    await recordAttackCallback(
      `${unit.name} attacked in direction (${dx}, ${dy}).`
    );
    for (let i = 1; i <= unit.range; i++) {
      const targetX = unit.x + dx * i;
      const targetY = unit.y + dy * i;
      if (!this.isWithinBounds(targetX, targetY)) break;

      // Check for an ally (different from the attacker).
      const ally = this.party.find(
        h => h.x === targetX && h.y === targetY && h !== unit
      );
      if (ally) {
        if (unit.heal && unit.heal > 0) {
          ally.hp += unit.heal;
          this.logCallback(
            `${unit.name} heals ${ally.name} for ${unit.heal} HP! (New HP: ${ally.hp})`
          );
        } else {
          this.logCallback(
            `${unit.name} attacks ${ally.name} but nothing happens.`
          );
        }
        this.awaitingAttackDirection = false;
        await this.shortPause();
        this.nextTurn();
        return;
      }

      // Check for an enemy.
      const enemy = this.enemies.find(e => e.x === targetX && e.y === targetY);
      if (enemy) {
        enemy.hp -= unit.attack;
        this.logCallback(
          `${unit.name} attacks ${enemy.name} for ${unit.attack} damage! (HP left: ${enemy.hp})`
        );
        if (unit.burn) {
          enemy.statusEffects.burn = { damage: unit.burn, duration: 3 };
          this.logCallback(
            `${enemy.name} is now burning for ${unit.burn} damage per turn for 3 turns!`
          );
        }
        if (unit.sluj) {
          if (!enemy.statusEffects.sluj) {
            enemy.statusEffects.sluj = {
              level: unit.sluj,
              duration: 4,
              counter: 0,
            };
          } else {
            enemy.statusEffects.sluj.level += unit.sluj;
            enemy.statusEffects.sluj.duration = 4;
          }
          this.logCallback(
            `${enemy.name} is afflicted with slüj (level ${enemy.statusEffects.sluj.level}) for 4 turns!`
          );
        }

        // Apply knockback if the attacking hero has the yeet stat.
        if (unit.yeet && unit.yeet > 0) {
          applyKnockback(
            enemy,
            dx,
            dy,
            unit.yeet,
            unit.attack,
            this.battlefield,
            this.logCallback,
            this.isWithinBounds.bind(this)
          );
        }
        if (enemy.hp <= 0) {
          this.logCallback(`${enemy.name} is defeated!`);
          this.battlefield[targetY][targetX] = '.';
          this.enemies = this.enemies.filter(e => e !== enemy);
        }
        this.awaitingAttackDirection = false;
        await this.shortPause();
        this.nextTurn();
        return;
      }
      // Check for the wall.
      if (
        this.battlefield[targetY][targetX] === 'ᚙ' ||
        this.battlefield[targetY][targetX] === '█'
      ) {
        this.wallHP -= unit.attack;
        this.logCallback(
          `${unit.name} attacks the wall for ${unit.attack} damage! (Wall HP: ${this.wallHP})`
        );
        this.awaitingAttackDirection = false;
        if (this.wallHP <= 0 && !this.transitioningLevel) {
          this.handleWallCollapse();
          return;
        }
        await this.shortPause();
        this.nextTurn();
        return;
      }
    }
    this.logCallback(`${unit.name} attacks, but there's nothing in range.`);
    this.awaitingAttackDirection = false;
    await this.shortPause();
    this.nextTurn();
  }

  isWithinBounds(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  handleWallCollapse() {
    this.logCallback('The Wall Collapses!');
    this.transitioningLevel = true;
    setTimeout(() => {
      if (typeof this.onLevelComplete === 'function') {
        this.onLevelComplete();
      }
    }, 1500);
  }

  /**
   * Applies Mellitron's swarm damage.
   * For each hero with a swarm ability (e.g., Mellitron), any enemy occupying
   * an adjacent cell takes damage equal to the hero's current swarm stat.
   */
  applySwarmDamage() {
    const adjacentOffsets = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 }
    ];

    this.party.forEach(hero => {
      if (hero.swarm && typeof hero.swarm === 'number') {
        adjacentOffsets.forEach(offset => {
          const targetX = hero.x + offset.x;
          const targetY = hero.y + offset.y;
          if (this.isWithinBounds(targetX, targetY)) {
            const enemy = this.enemies.find(e => e.x === targetX && e.y === targetY);
            if (enemy) {
              const damage = hero.swarm;
              enemy.hp -= damage;
              this.logCallback(
                `${hero.name}'s swarm deals ${damage} damage to ${enemy.name} at (${targetX},${targetY})! (HP left: ${enemy.hp})`
              );
              if (enemy.hp <= 0) {
                this.logCallback(`${enemy.name} is defeated by swarm damage!`);
                this.battlefield[targetY][targetX] = '.';
                this.enemies = this.enemies.filter(e => e !== enemy);
              }
            }
          }
        });
      }
    });
  }

  enemyTurn() {
    if (this.transitioningLevel) return;
    this.enemies.forEach(enemy => {
      // Move enemy based on its agility.
      for (let moves = 0; moves < enemy.agility; moves++) {
        this.moveEnemy(enemy);
      }
      // Enemy attacks adjacent heroes.
      this.enemyAttackAdjacent(enemy);
      // Trigger enemy dialogue if defined.
      if (Array.isArray(enemy.dialogue) && enemy.dialogue.length > 0) {
        const randomIndex = Math.floor(Math.random() * enemy.dialogue.length);
        this.logCallback(`${enemy.name} says: "${enemy.dialogue[randomIndex]}"`);
      }
    });
    this.logCallback('Enemy turn completed.');
  }

  moveEnemy(enemy) {
    const targetHero = this.findClosestHero(enemy);
    if (!targetHero) return;
    const dx = targetHero.x - enemy.x;
    const dy = targetHero.y - enemy.y;
    let stepX = 0,
      stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) {
      stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    } else {
      stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    }
    if (!this.canMove(enemy.x + stepX, enemy.y + stepY)) {
      if (stepX !== 0 && this.canMove(enemy.x, enemy.y + Math.sign(dy))) {
        stepY = dy > 0 ? 1 : -1;
        stepX = 0;
      } else if (stepY !== 0 && this.canMove(enemy.x + Math.sign(dx), enemy.y)) {
        stepX = dx > 0 ? 1 : -1;
        stepY = 0;
      }
    }
    const newX = enemy.x + stepX;
    const newY = enemy.y + stepY;
    if (this.canMove(newX, newY)) {
      this.battlefield[enemy.y][enemy.x] = '.';
      enemy.x = newX;
      enemy.y = newY;
      this.battlefield[newY][newX] = enemy.symbol;
    }
  }

  findClosestHero(enemy) {
    if (this.party.length === 0) return null;
    return this.party.reduce((closest, hero) => {
      const currentDistance =
        Math.abs(closest.x - enemy.x) + Math.abs(closest.y - enemy.y);
      const heroDistance =
        Math.abs(hero.x - enemy.x) + Math.abs(hero.y - enemy.y);
      return heroDistance < currentDistance ? hero : closest;
    });
  }

  canMove(x, y) {
    return this.isWithinBounds(x, y) && (this.battlefield[y][x] === '.' || this.levelObjectSymbols.has(this.battlefield[y][x]));
  }

  enemyAttackAdjacent(enemy) {
    const directions = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    directions.forEach(([dx, dy]) => {
      const tx = enemy.x + dx;
      const ty = enemy.y + dy;
      const targetHero = this.party.find(
        hero => hero.x === tx && hero.y === ty
      );
      if (targetHero) {
        targetHero.hp -= enemy.attack;
        this.logCallback(
          `${enemy.name} attacks ${targetHero.name} for ${enemy.attack} damage! (Hero HP: ${targetHero.hp})`
        );
        if (targetHero.hp <= 0) {
          this.logCallback(`${targetHero.name} is defeated!`);
          this.battlefield[targetHero.y][targetHero.x] = '.';
          this.party = this.party.filter(h => h !== targetHero);
          if (this.currentUnit >= this.party.length) {
            this.currentUnit = 0;
          }
        }
      }
    });
  }

  nextTurn() {
    if (this.transitioningLevel) return;
    
    // Process status effects first.
    this.applyStatusEffects();

    // Apply swarm damage from heroes like Mellitron.
    this.applySwarmDamage();

    // If after status effects no heroes remain, the game is over.
    if (this.party.length === 0) {
      this.logCallback('All heroes have been defeated! Game Over.');
      if (typeof this.onGameOver === 'function') this.onGameOver();
      return;
    }

    // Ensure currentUnit is valid, especially if the party size changed.
    if (this.currentUnit >= this.party.length) {
      this.currentUnit = 0;
    }

    this.awaitingAttackDirection = false;
    this.currentUnit++;
    if (this.currentUnit >= this.party.length) {
      this.currentUnit = 0;
      this.logCallback('Enemy turn begins.');
      this.enemyTurn();
      this.applyStatusEffects();
      if (this.party.length === 0) {
        this.logCallback('All heroes have been defeated! Game Over.');
        if (typeof this.onGameOver === 'function') this.onGameOver();
        return;
      }
    }
    this.movePoints = this.party[this.currentUnit].agility;
    this.logCallback(`Now it's ${this.party[this.currentUnit].name}'s turn.`);
  }

  applyStatusEffects() {
    this.party.forEach(hero => {
      if (hero.statusEffects.burn && hero.statusEffects.burn.duration > 0) {
        this.logCallback(
          `${hero.name} is burned and takes ${hero.statusEffects.burn.damage} damage!`
        );
        hero.hp -= hero.statusEffects.burn.damage;
        hero.statusEffects.burn.duration--;
        if (hero.hp <= 0) {
          this.logCallback(`${hero.name} was defeated by burn damage!`);
          this.battlefield[hero.y][hero.x] = '.';
        }
      }
    });
    this.party = this.party.filter(hero => hero.hp > 0);

    this.enemies.forEach(enemy => {
      if (enemy.statusEffects.burn && enemy.statusEffects.burn.duration > 0) {
        this.logCallback(
          `${enemy.name} is burned and takes ${enemy.statusEffects.burn.damage} damage!`
        );
        enemy.hp -= enemy.statusEffects.burn.damage;
        enemy.statusEffects.burn.duration--;
        if (enemy.hp <= 0) {
          this.logCallback(`${enemy.name} was defeated by burn damage!`);
          this.battlefield[enemy.y][enemy.x] = '.';
        }
      }
      if (enemy.statusEffects.sluj && enemy.statusEffects.sluj.duration > 0) {
        enemy.statusEffects.sluj.counter++;
        const level = enemy.statusEffects.sluj.level;
        let trigger = false;
        let damage = 0;
        if (level === 1 && enemy.statusEffects.sluj.counter % 4 === 0) {
          trigger = true;
          damage = 1;
        } else if (level === 2 && enemy.statusEffects.sluj.counter % 3 === 0) {
          trigger = true;
          damage = 1;
        } else if (level === 3 && enemy.statusEffects.sluj.counter % 2 === 0) {
          trigger = true;
          damage = 1;
        } else if (level === 4) {
          trigger = true;
          damage = 1;
        } else if (level === 5) {
          trigger = true;
          damage = 2;
        } else if (level >= 6) {
          trigger = true;
          damage = 3;
        }
        if (trigger) {
          this.logCallback(`${enemy.name} takes ${damage} slüj damage!`);
          enemy.hp -= damage;
        }
        enemy.statusEffects.sluj.duration--;
        if (enemy.hp <= 0) {
          this.logCallback(`${enemy.name} is defeated by slüj damage!`);
          this.battlefield[enemy.y][enemy.x] = '.';
        }
      }
    });
    this.enemies = this.enemies.filter(enemy => enemy.hp > 0);
  }

  shortPause() {
    return new Promise(resolve => setTimeout(resolve, 300));
  }
}
