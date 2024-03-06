const app = require("express")();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { cpp } = require("compile-run");
const fs = require("node:fs");

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", function (req, res) {
  res.send("Hello from the server!");
});

app.get("/compile", async (req, res) => {
  var inputData;

  try {
    const data = fs.readFileSync("./compile-run2/input.txt", "utf8");
    inputData = data;
    console.log(data);
  } catch (err) {
    console.error(err);
  }

  let resultPromise = await cpp.runFile("./compile-run2/code.cpp", {
    stdin: `${inputData}`,
  });

  if (resultPromise.stderr) {
    res.send(resultPromise.stderr);
  } else {
    console.log(resultPromise.stdout);
    res.send(resultPromise.stdout);
  }
});

const socketID_to_Users_Map = {};
const roomID_to_Code_Map = {};

async function getUsersinRoom(roomId, io) {
  const socketList = await io.in(roomId).allSockets();
  const userslist = [];
  socketList.forEach((each) => {
    each in socketID_to_Users_Map &&
      userslist.push(socketID_to_Users_Map[each].username);
  });

  return userslist;
}

async function updateUserslistAndCodeMap(io, socket, roomId) {
  socket.in(roomId).emit("member left", {
    username: socketID_to_Users_Map[socket.id].username,
  });

  // update the user list
  delete socketID_to_Users_Map[socket.id];
  const userslist = await getUsersinRoom(roomId, io);
  socket.in(roomId).emit("updating client list", { userslist: userslist });

  userslist.length === 0 && delete roomID_to_Code_Map[roomId];
}

//Whenever someone connects this gets executed
io.on("connection", function (socket) {
  console.log("A user connected", socket.id);

  socket.on("when a user joins", async ({ roomId, username }) => {
    console.log("username: ", username);
    socketID_to_Users_Map[socket.id] = { username };
    socket.join(roomId);

    const userslist = await getUsersinRoom(roomId, io);

    // for other users, updating the client list
    socket.in(roomId).emit("updating client list", { userslist: userslist });

    // for this user, updating the client list
    io.to(socket.id).emit("updating client list", { userslist: userslist });

    // send the latest code changes to this user when joined to existing room
    if (roomId in roomID_to_Code_Map) {
      io.to(socket.id).emit("on language change", {
        languageUsed: roomID_to_Code_Map[roomId].languageUsed,
      });
      io.to(socket.id).emit("on code change", {
        code: roomID_to_Code_Map[roomId].code,
      });
      io.to(socket.id).emit("on input change", {
        input: roomID_to_Code_Map[roomId].input,
      });
      io.to(socket.id).emit("on output change", {
        output: roomID_to_Code_Map[roomId].output,
      });
    }

    // alerting other users in room that new user joined
    socket.in(roomId).emit("new member joined", {
      username,
    });
  });

  // for other users in room to view the changes
  socket.on("update language", ({ roomId, languageUsed }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]["languageUsed"] = languageUsed;
    } else {
      roomID_to_Code_Map[roomId] = { languageUsed };
    }
  });

  // for user editing the code to reflect on his/her screen
  socket.on("syncing the language", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on language change", {
        languageUsed: roomID_to_Code_Map[roomId].languageUsed,
      });
    }
  });

  // for other users in room to view the changes
  socket.on("update code", ({ roomId, code }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]["code"] = code;

      console.log(code);
      fs.writeFile("./compile-run2/code.cpp", code, (err) => {
        if (err) {
          console.error(err);
        } else {
          console.log("File written successfully");
        }
      });
    } else {
      roomID_to_Code_Map[roomId] = { code };
    }
  });

  // for user editing the code to reflect on his/her screen
  socket.on("syncing the code", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket
        .in(roomId)
        .emit("on code change", { code: roomID_to_Code_Map[roomId].code });
    }
  });

  socket.on("update input", ({ roomId, input }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]["input"] = input;
      fs.writeFile("./compile-run2/input.txt", input, (err) => {
        if (err) {
          console.error(err);
        } else {
          console.log("input written successfully");
        }
      });
    } else {
      // roomID_to_Code_Map[roomId] = { input };
    }
  });

  socket.on("syncing the input", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket
        .in(roomId)
        .emit("on input change", { input: roomID_to_Code_Map[roomId].input });
    }
  });

  socket.on("update output", ({ roomId, output }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId]["output"] = output;
    } else {
      roomID_to_Code_Map[roomId] = { output };
      console.log("output updated");
    }
  });

  socket.on("syncing the output", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on output change", { output: roomID_to_Code_Map[roomId].output });
    }
  });
  socket.on("leave room", ({ roomId }) => {
    socket.leave(roomId);
    updateUserslistAndCodeMap(io, socket, roomId);
  });

  socket.on("disconnecting", (reason) => {
    socket.rooms.forEach((eachRoom) => {
      if (eachRoom in roomID_to_Code_Map) {
        updateUserslistAndCodeMap(io, socket, eachRoom);
      }
    });
  });

  //Whenever someone disconnects this piece of code executed
  socket.on("disconnect", function () {
    console.log("A user disconnected");
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, function () {
  console.log(`listening on port : ${PORT}`);
});
