// import { Kalaha } from './kalaha.js';
// import { KalahaBoard } from './kalahaboard.js';

const p0Name = document.querySelector('.player0');
const p1Name = document.querySelector('.player1');
const messageText = document.querySelector('.message');
const signInStatus = document.querySelector('.sign-in .status');
const challengeStatus = document.querySelector('.challenge .status');
const boardView = new KalahaBoard(document.querySelector('.board-wrapper'));

window.addEventListener('resize', () => boardView.render());

function activatePlayer(player) {
    boardView.activatePlayer(player);
    boardView.inactivatePlayer((player + 1) % 2);
    if (player === 0) {
        messageText.innerHTML = `${username}, your turn.`
    } else {
        messageText.innerHTML = `Waiting for ${seekUsername}.`
    }
}

let username = null;
let seekUsername = null;
let gameId = null;
let db = null;

firebase.auth().signInAnonymously()
    .then(() => console.log('Signed in anonymously.', firebase.auth().currentUser))
    .then(() => { db = firebase.firestore() })
    .then(() => db.collection('users').doc(firebase.auth().currentUser.uid).get())
    .then(userDocSnapshot => {
        username = userDocSnapshot.get('username') || null;
        seekUsername = userDocSnapshot.get('seek-username') || null;
        setUsername(username);
        p1Name.value = seekUsername;
        userDocSnapshot.ref.update({
            'seek-username': firebase.firestore.FieldValue.delete(),
            'game-id': firebase.firestore.FieldValue.delete(),
        });
    })
    .then(() => attachListeners())
    .catch(e => console.error('Error signing in: ', e));

function setUsername(name) {
    if (!name) {
        return;
    }

    if (name === username) {
        signInStatus.innerHTML = username ? 'done' : ''; 
    }

    if (name && name !== username) {
        username = name;
        db.collection('users').doc(firebase.auth().currentUser.uid).set({
            'username': username,
        }, { merge: true })
        .then(() => {
            signInStatus.innerHTML = username ? 'done' : ''; 
        })
        .catch(e => {
            signInStatus.innerHTML = '';
            console.error('Could not set username: ', e);
        });
    }

    p0Name.value = username;
}

function setSeekUsername(name) {
    if (!name) {
        return;
    }

    seekUsername = name;
    let userDocRef = db.collection('users').doc(firebase.auth().currentUser.uid);
    userDocRef.update({
        'seek-username': seekUsername,
    })
    .then(() => { challengeStatus.innerHTML = 'done'; })
    .catch(e => { 
        challengeStatus.innerHTML = '';
        console.error('Could not register challenge: ', e);
    })
    .then(() => db.collection('users')
        .where('username', '==', seekUsername)
        .where('seek-username', '==', username)
        .limit(1).get()
    )
    .then(opponentQuerySnapshot => {
        if (opponentQuerySnapshot.empty) {
            throw 'No matching opponent online.';
        }
        opponentQuerySnapshot.forEach(opponentQueryDocRef =>
            db.collection('games').add({ 
                'player0': firebase.auth().currentUser.uid,
                'player1': opponentQueryDocRef.id,
            })
            .then(newGameDocRef =>
                opponentQueryDocRef.ref.update({
                    'game-id': newGameDocRef.id,
                    'seek-username': firebase.firestore.FieldValue.delete(),
                })
                .then(() => userDocRef.update({ 
                    'game-id': newGameDocRef.id,
                    'seek-username': firebase.firestore.FieldValue.delete(),
                }))
            )
            .then(() => console.log('Game created successfully.'))
        );
    })
    .catch(e => console.error('Could not search for opponent: ', e));

    p1Name.value = seekUsername;
}

function attachListeners() {
    document.querySelector('.sign-in').addEventListener('click', () => {
        setUsername(p0Name.value);
    });

    document.querySelector('.challenge').addEventListener('click', () => {
        setSeekUsername(p1Name.value);
    });

    db.collection('users').doc(firebase.auth().currentUser.uid).onSnapshot(doc => {
        const newGameId = doc.get('game-id');
        if (newGameId) {
            setupGame(newGameId);
        }
    });

    console.log('listeners attached');
}

let lastSeenMoveTimestamp = undefined;
let gameState = {
    board: new Kalaha(Array(12).fill(0).concat(24, 24)),
    player: undefined,
};
boardView.render(gameState.board.state);

function setupGame(newGameId) {
    gameId = newGameId;
    challengeStatus.innerHTML = 'done_all';

    gameState = {
        board: new Kalaha(),
        player: undefined,
    };
    boardView.render(gameState.board.state);

    db.collection('games').doc(gameId).get()
        .then(docSnapshot => {
            const player0Uid = docSnapshot.get('player0');
            const isLocalPlayer = player0Uid === firebase.auth().currentUser.uid;
            gameState.player = isLocalPlayer ? 0 : 1;
            activatePlayer(gameState.player);
        });

    db.collection('games').doc(gameId)
        .collection('moves').orderBy('timestamp')
        .onSnapshot(moveQuerySnapshot => moveQuerySnapshot.forEach(moveQueryDocSnapshot => {
            const moveTimestamp = moveQueryDocSnapshot.get('timestamp');
            if (moveTimestamp <= lastSeenMoveTimestamp) {
                return;
            }
            lastSeenMoveTimestamp = moveTimestamp;

            const playerUid = moveQueryDocSnapshot.get('uid');
            const house = moveQueryDocSnapshot.get('house');
            const isLocalPlayer = playerUid === firebase.auth().currentUser.uid;
            makeMove(
                isLocalPlayer ? 0 : 1,
                isLocalPlayer ? house : house + 6
            );
        }));
}

function makeMove(player, slotIdx) {
    const moveResult = gameState.board.move(slotIdx, player);
    if (moveResult === null) {
        console.error('Received invalid move.', player, slotIdx);
        return; // invalid move
    }

    const [boardDistribute, boardPickup] = moveResult;
    boardView.render(boardDistribute.state).then(() => boardView.render(boardPickup.state));

    gameState.board = boardPickup;
    gameState.player = (player + 1) % 2;
    activatePlayer(gameState.player);

    if (!gameState.board.canMove(gameState.player)) {
        const p0Score = gameState.board.playerScore(0);
        const p1Score = gameState.board.playerScore(1);
        if (p0Score > p1Score) {
            messageText.innerHTML = `${username} wins with ${p0Score} &mdash; ${p1Score}.`;
        } else if (p1Score > p0Score) {
            messageText.innerHTML = `${seekUsername} wins with ${p1Score} &mdash; ${p0Score}.`;
        } else {
            messageText.innerHTML = `The game is drawn at ${p0Score} each! Another one?`;
        }
    }
}

boardView.houses.forEach((houseView, slotIdx) => {
    houseView.addEventListener('click', _ => {
        if (gameState.player !== 0) {
            return;
        }

        console.log('click', slotIdx);
        db.collection('games').doc(gameId).collection('moves').add({
            'uid': firebase.auth().currentUser.uid,
            'house': slotIdx,
            'timestamp': firebase.firestore.FieldValue.serverTimestamp(),
        })
        .then(() => console.log('Move added successfully.'))
        .catch(e => console.error('Could not add move: ', e));
    });
});