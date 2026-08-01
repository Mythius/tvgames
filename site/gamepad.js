// ctx must be defined.
// Vector Must be defined {x:Number,y:Number}
/*

const canvas = obj('canvas');
const ctx = canvas.getContext('2d');

Gamepad.addCanvas(canvas);
new Gamepad.Joystick(60); // 60 pixels in radius
new Gamepad.Button(25, new Vector(canvas.width - 70, canvas.height - 30));
new Gamepad.Button(25, new Vector(canvas.width - 30, canvas.height - 70));
new Gamepad.Button(25, new Vector(canvas.width - 110, canvas.height - 70));
new Gamepad.Button(25, new Vector(canvas.width - 70, canvas.height - 110));
// new Gamepad.dPad(20, new Vector(canvas.width / 2, canvas.height / 2), 2);
Touch.init(data => {
	Gamepad.touchController(data, action => {
		obj('p').innerHTML = JSON.stringify(action);
	});
}, { zoom: false });

function loop() {
	setTimeout(loop, 1000 / 30);
	ctx.clearRect(-2, -2, canvas.width + 2, canvas.height + 2);
	Gamepad.draw();
}

loop();

*/
(function (glob) {
  var Gamepad = {};
  glob.Gamepad = Gamepad;

  Gamepad.color1 = "#321";
  Gamepad.color2 = "blue";
  Gamepad.lineWidth = 5;

  Gamepad.button = {};
  Gamepad.joystick = {};

  Gamepad.button.circle = new Path2D();
  Gamepad.button.square = new Path2D();
  Gamepad.button.arrow = new Path2D();
  Gamepad.button.pentagon = new Path2D();
  Gamepad.joystick.socket = new Path2D();
  Gamepad.joystick.stick = new Path2D();

  let canvas;

  let joystick_id = 0;
  Gamepad.Joystick = class Joystick {
    constructor(size = 100, pos) {
      if (!pos) pos = new Vector(size + 10, canvas.height - 10 - size);
      Gamepad.joystick.socket.arc(0, 0, size, 0, Math.PI * 2);
      Gamepad.joystick.stick.arc(0, 0, size / 3, 0, Math.PI * 2);
      this.offsetX = 0;
      this.offsetY = 0;
      this.position = pos;
      this.socket = Gamepad.joystick.socket;
      this.stick = Gamepad.joystick.stick;
      this.size = size;
      this.id = `joystick${joystick_id++}`;
      this.offsetX = 0;
      this.offsetY = 0;
      Gamepad.elements.push(this);
    }
    draw(vis = true) {
      ctx.beginPath();
      ctx.lineWidth = 10;
      ctx.strokeStyle = Gamepad.color1;
      ctx.fillStyle = Gamepad.color2;
      ctx.save();
      ctx.translate(this.position.x, this.position.y);
      var active = false;
      const THIS = this;
      if (vis) ctx.fill(this.socket);
      if (vis) ctx.stroke(this.socket);
      // ctx.restore();
      // ctx.save();
      ctx.translate(this.offsetX, this.offsetY);
      if (active) ctx.fillStyle = Gamepad.color1;
      if (vis) ctx.fill(this.stick);
      if (vis) ctx.stroke(this.stick);
      ctx.restore();
    }
  };

  let button_id = 0;
  Gamepad.Button = class Button {
    constructor(size = 25, pos, type = "circle", id) {
      if (type == "circle")
        Gamepad.button.circle.arc(0, 0, size, 0, Math.PI * 2);
      if (type == "pentagon") {
        Gamepad.button.pentagon.moveTo(0, 0);
        Gamepad.button.pentagon.lineTo(-size, -size);
        Gamepad.button.pentagon.lineTo(-size, -size * 2.5);
        Gamepad.button.pentagon.lineTo(size, -size * 2.5);
        Gamepad.button.pentagon.lineTo(size, -size);
        Gamepad.button.pentagon.closePath();
      }
      this.down = false;
      this.position = pos;
      this.path =
        type == "circle" ? Gamepad.button.circle : Gamepad.Button.pentagon;
      this.id = id ? id : `button${button_id++}`;
      this.size = size;
      this.isOwnParent = true;
      Gamepad.elements.push(this);
    }
    draw(translate = true, vis = this.isOwnParent) {
      if (translate) ctx.save();
      ctx.strokeStyle = Gamepad.color1;
      ctx.fillStyle = Gamepad.color2;
      ctx.lineWidth = Gamepad.lineWidth;
      if (translate) ctx.translate(this.position.x, this.position.y);
      ctx.fillStyle = this.down ? Gamepad.color1 : Gamepad.color2;
      if (vis) ctx.fill(this.path);
      if (vis) ctx.stroke(this.path);
      if (translate) ctx.restore();
    }
  };

  let dpad_id = 0;
  Gamepad.dPad = class dPad {
    constructor(size = 20, pos = new Vector(), lenMult = 2) {
      this.position = pos;
      this.up = new Gamepad.Button(
        size,
        pos,
        "pentagon",
        `dPad${dpad_id++}-up`
      );
      this.up.path = Gamepad.button.pentagon;
      this.up.isOwnParent = false;
      this.down = new Gamepad.Button(
        size,
        pos,
        "pentagon",
        `dPad${dpad_id++}-down`
      );
      this.down.path = Gamepad.button.pentagon;
      this.down.isOwnParent = false;
      this.left = new Gamepad.Button(
        size,
        pos,
        "pentagon",
        `dPad${dpad_id++}-left`
      );
      this.left.path = Gamepad.button.pentagon;
      this.left.isOwnParent = false;
      this.right = new Gamepad.Button(
        size,
        pos,
        "pentagon",
        `dPad${dpad_id++}-right`
      );
      this.right.path = Gamepad.button.pentagon;
      this.right.isOwnParent = false;
      Gamepad.elements.push(this);
    }
    draw(vis = true) {
      let btns = [this.up, this.right, this.down, this.left];
      ctx.beginPath();
      ctx.save();
      ctx.translate(this.position.x, this.position.y);
      for (let btn of btns) {
        btn.draw(false, vis);
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
    }
  };

  Gamepad.draw = function () {
    if (!Gamepad.show) return;
    ctx.globalAlpha = 0.3;
    for (let elements of Gamepad.elements) {
      elements.draw();
    }
    ctx.globalAlpha = 1;
  };

  function onTouch(data, callback) {
    for (let element of Gamepad.elements) {
      if (
        (data.type == "scroll" || data.type == "click") &&
        element instanceof Gamepad.Joystick
      ) {
        if (data.isFirst && data.type == "scroll") {
          if (
            ctx.isPointInPath(
              element.socket,
              data.x - element.position.x,
              data.y - element.position.y
            )
          ) {
            element.firstTouch = data;
          }
        } else if (
          element.firstTouch ||
          (data.type == "click" &&
            ctx.isPointInPath(
              element.socket,
              data.x - element.position.x,
              data.y - element.position.y
            ))
        ) {
          let direction = Vector.getDir(
            element.position.x - data.x,
            element.position.y - data.y
          );
          let distance =
            Math.min(
              Vector.distance(
                data.x,
                data.y,
                element.position.x,
                element.position.y
              ),
              element.size
            ) / element.size;
          let stickPos = Vector.getPointIn(
            Vector.rad(direction),
            distance * element.size
          );
          element.offsetX = stickPos.x;
          element.offsetY = stickPos.y;
          if (data.type == "click") {
            setTimeout(() => {
              element.offsetX = 0;
              element.offsetY = 0;
            }, 150);
          }
          callback({
            from: element.id,
            type: "joystick",
            direction,
            distance,
          });
        }
      } else if (data.type == "end" && element instanceof Gamepad.Joystick) {
        element.firstTouch = null;
        element.offsetX = 0;
        element.offsetY = 0;
      } else if (data.type == "click" && element instanceof Gamepad.Button) {
        if (
          ctx.isPointInPath(
            element.path,
            data.x - element.position.x,
            data.y - element.position.y
          )
        ) {
          element.down = true;
          setTimeout(() => {
            element.down = false;
          }, 200);
          callback({
            from: element.id,
            type: "button",
            event: "clicked",
          });
        }
      }
    }
  }

  Gamepad.touchController = onTouch;

  Gamepad.show = true;

  Gamepad.elements = [];

  // Touchscreen Events

  // Define Looks

  // Gamepad.button.square.rect(-40,-40,80,80);

  Gamepad.addCanvas = function (c) {
    canvas = c;
  };
})(this);
