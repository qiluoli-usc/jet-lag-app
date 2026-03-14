import {
  createRoom,
  joinRoom,
  setReady,
  submitAnswer,
  submitQuestion,
  tick,
  updateLocation,
} from "../src/game/stateMachine.js";
import { appendRoomEvent, rebuildRoomProjection, rooms } from "../src/game/store.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runInvalidEventRejectTest() {
  rooms.clear();

  const roomView = createRoom({ name: "task1-invalid-event-room" });
  const room = rooms.get(roomView.id);
  assert(room, "Room should exist for invalid-event test");

  let error = null;
  try {
    appendRoomEvent(room, {
      type: "question.asked",
      data: { id: "q_only_id" },
    });
  } catch (caught) {
    error = caught;
  }

  assert(error, "Invalid event should throw");
  assert(Number(error.status) === 400, `Invalid event should return 400, got ${String(error.status)}`);
}

function runReplayConsistencyTest() {
  rooms.clear();

  const roomView = createRoom({
    name: "task1-replay-room",
    rules: {
      hideDurationSec: 0,
      seekDurationSec: 120,
      questionCooldownSec: 1,
      catchDistanceMeters: 100,
      catchHoldSeconds: 0,
      hiderClueUnlockAfterSec: 0,
    },
  });

  const hider = joinRoom(roomView.id, { name: "H", role: "hider" });
  const seeker = joinRoom(roomView.id, { name: "S", role: "seeker" });

  setReady(roomView.id, { playerId: hider.id, ready: true });
  setReady(roomView.id, { playerId: seeker.id, ready: true });
  tick(Date.now() + 1000);

  updateLocation(roomView.id, { playerId: hider.id, lat: 31.23, lng: 121.47, accuracy: 10 });
  updateLocation(roomView.id, { playerId: seeker.id, lat: 31.23, lng: 121.47, accuracy: 10 });

  const question = submitQuestion(roomView.id, {
    playerId: seeker.id,
    category: "matching",
    prompt: "Are you in the same district?",
  });

  submitAnswer(roomView.id, {
    playerId: hider.id,
    questionId: question.id,
    kind: "yes_no",
    value: "yes",
    autoVerified: true,
  });

  const room = rooms.get(roomView.id);
  assert(room, "Room should exist for replay test");

  const projectionBeforeRebuild = JSON.stringify(room.eventProjection);
  const rebuiltProjection = JSON.stringify(rebuildRoomProjection(room));
  assert(
    projectionBeforeRebuild === rebuiltProjection,
    "Projection mismatch after replay rebuild",
  );
}

function main() {
  runInvalidEventRejectTest();
  console.log("PASS invalid event reject test");

  runReplayConsistencyTest();
  console.log("PASS replay consistency test");

  console.log("TASK1_TEST_OK");
}

try {
  main();
} catch (error) {
  console.error("TASK1_TEST_FAIL", error?.message ?? String(error));
  process.exit(1);
}
