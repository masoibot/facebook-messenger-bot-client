const { ChatManager, TokenProvider } = require('@pusher/chatkit-client');
const goStage = require('../src/goStage');
const { isAlive, isWolf, phe, extractUserRole } = require('../src/DataUtils');
const { checkReceiveChat } = require("./ChatUtils");

module.exports = class UserInstance {
    constructor() {
        this.users = [];
        this.userIDs = [];
        this.datas = [];
        this.playerLists = [];
        this.roomIDs = [];
        this.readys = [];
    }
    setInstance(joinID, userInstance) {
        this.users[joinID] = userInstance;
    }
    getInstance(joinID) {
        return this.users[joinID];
    }
    setData(joinID, data) {
        this.datas[joinID] = data;
    }
    getData(joinID) {
        return this.datas[joinID];
    }
    setUserID(joinID, userID) {
        this.userIDs[joinID] = userID;
    }
    getUserID(joinID) {
        return this.userIDs[joinID];
    }
    setPlayerList(joinID, playerList) {
        this.playerLists[joinID] = playerList;
    }
    getPlayerList(joinID) {
        return this.playerLists[joinID];
    }
    getRoomID(joinID) {
        return this.roomIDs[joinID];
    }
    setRoomID(joinID, roomID) {
        this.roomIDs[joinID] = roomID;
    }
    getReady(joinID) {
        return !!this.readys[joinID];
    }
    invertReady(joinID) {
        this.readys[joinID] = !this.readys[joinID];
    }
    module(factory, bot) {
        return factory.apply(this, [this, bot]);
    }
    connectChat(userID, joinID, chat) {
        var newChatMgr = new ChatManager({
            instanceLocator: "v1:us1:754dee8b-d6c4-41b4-a6d6-7105da589788",
            userId: userID,
            tokenProvider: new TokenProvider({
                url: "https://us1.pusherplatform.io/services/chatkit_token_provider/v1/754dee8b-d6c4-41b4-a6d6-7105da589788/token"
            })
        });
        return newChatMgr.connect({
            onRemovedFromRoom: room => {
                console.log("kicked out room");
                chat.say(`Bạn đã rời khỏi phòng chơi!`);
                this.setRoomID(joinID, undefined);
                this.leaveChat();
            }
        }).then(currentUser => {
            this.setUserID(joinID, userID);
            this.setInstance(joinID, currentUser);
            return currentUser;
        })
    }
    leaveChat(joinID) {
        var currentUser = this.getInstance(joinID);
        if (currentUser && currentUser.roomSubscriptions && currentUser.roomSubscriptions[this.getRoomID(joinID)]) {
            currentUser.roomSubscriptions[this.getRoomID(joinID)].cancel();
        }
    }
    timeLeftToString(timeLeft) {
        if (isNaN(timeLeft) || timeLeft < 0) return "";
        var minute = Math.floor(timeLeft / 60);
        var second = timeLeft % 60;
        return `[${minute > 0 ? `${minute}:` : "0:"}${second < 10 ? `0${second}` : `${second}`}] `;
    }
    chatSayMessage(chat, userID, message, timeLeft = -1) {
        if (message.sender.id !== userID) {
            if (message.attachment && message.attachment.type && message.attachment.link) {
                // attachment
                console.log(`${message.sender.name}: attachment`);
                chat.say([`${this.timeLeftToString(timeLeft)}${message.sender.name} đã gửi...`, {
                    attachment: message.attachment.type,
                    url: message.attachment.link
                }])
            } else {
                // text
                console.log(`${message.sender.name}: ${message.text}`);
                chat.say(`${this.timeLeftToString(timeLeft)}${message.sender.name}:\n${message.text}`);
            }
        } else {
            chat.sendAction('mark_seen');
        }
    }
    subscribeChat(roomID, joinID, chat, convo) {
        var currentUser = this.getInstance(joinID);
        if (!currentUser) {
            chat.say(`Vui lòng đăng nhập!\nsubcribe_error_not_connected`);
            return;
        }
        if (this.getRoomID(joinID)) {
            this.leaveChat();
            chat.say(`ℹ️Bạn đã rời phòng ${this.getRoomID(joinID)} để tham gia phòng ${roomID}!`);
        }
        currentUser.subscribeToRoom({
            roomId: roomID,
            hooks: {
                onMessage: message => {
                    let userID = this.getUserID(joinID);
                    var data = this.getData(joinID);
                    var userRole = data && data.setup ? extractUserRole(data, userID) : 4;
                    var userAlive = data ? isAlive(data, userID) : false;
                    if (message.text[0] === '{' && message.sender.id === "botquantro") {
                        // data from server
                        try {
                            var res = JSON.parse(message.text);
                            data = res.data;
                            let action = res.action;
                            let text = res.text;
                            if (action == "ready") {
                                chat.say(`PHÒNG ${roomID}\n` + Object.keys(data.players.ready).map((u, i) => {
                                    return `${data.players.ready[u] ? `🌟` : `☆`}${i + 1}: ${data.players.names[u]}`;
                                }).join("\n"));
                                return;
                            }
                            this.setData(joinID, data); // lưu gameData
                            let fullList = data.players.allID.filter((id) => { // lọc người còn sống
                                return isAlive(data, id);
                            });
                            let userIsWolf = isWolf(data, userID);
                            let coupleIndex = data.players.coupleID.indexOf(userID); //user_index
                            coupleIndex = coupleIndex != -1 ? (coupleIndex == 0 ? 1 : 0) : -1; //partner_index
                            var playerList = fullList.reduce((plist, p, index) => { // chuyển sang mảng vote [id: name]
                                plist[p] = `${userIsWolf ? (isWolf(data, p) ? "🐺" : "🎅") : ""}${data.players.coupleID[coupleIndex] == p ? "❤" : ""}${index}: ${data.players.names[p]}`;
                                return plist;
                            }, {});
                            this.setPlayerList(joinID, playerList); // lưu lại mạng vote
                            if (text != "") {
                                chat.say("```\n" + text + "\n```").then(() => {
                                    goStage(chat, data, userID, playerList);
                                })
                            } else {
                                goStage(chat, data, userID, playerList);
                            }
                        } catch (e) {
                            console.log(e);
                            convo.say(`MÀN HÌNH XANH HIỆN LÊN\nJSON_invalid_error`);
                        }
                    } else if (message.text[0] === '[') {
                        try {//is voteList from other
                            let content = JSON.parse(message.text)
                            var dayStage = data.state.dayStage;
                            if (dayStage == 'night' || dayStage == 'vote' || dayStage == 'voteYesNo') {
                                data = {
                                    ...data, roleTarget: {
                                        ...data.roleTarget,
                                        voteList: {
                                            ...data.roleTarget.voteList,
                                            [message.sender.id]: content[0].targetID
                                        }
                                    }
                                }
                                this.setData(joinID, data); // lưu gameData
                            }
                            if (checkReceiveChat(data, userID, userRole, userAlive)) {
                                let timeLeft = -1;
                                if (data && data.state && data.state.stageEnd != "") {
                                    timeLeft = (new Date(data.state.stageEnd) - new Date(Date.now())) / 1000;
                                    timeLeft = Math.floor(timeLeft);
                                }
                                this.chatSayMessage(chat, currentUser.id, {
                                    text: content[0].text,
                                    sender: {
                                        id: message.sender.id,
                                        name: message.sender.name
                                    }
                                }, timeLeft);
                            }
                        } catch (err) {
                            // console.log("receive_JSON_err", err);
                        }
                    } else {
                        // chat from other
                        if (checkReceiveChat(data, userID, userRole, userAlive)) {
                            let timeLeft = -1;
                            if (data && data.state && data.state.stageEnd != "") {
                                timeLeft = (new Date(data.state.stageEnd) - new Date(Date.now())) / 1000;
                                timeLeft = Math.floor(timeLeft);
                            }
                            this.chatSayMessage(chat, currentUser.id, message, timeLeft);
                            // if (message.sender.id !== currentUser.id) {
                            //     if (message.attachment && message.attachment.type && message.attachment.link) {
                            //         // attachment
                            //         chat.say([`${message.sender.name} đã gửi...`, {
                            //             attachment: message.attachment.type,
                            //             url: message.attachment.link
                            //         }])
                            //     } else {
                            //         // text
                            //         chat.say(`${message.sender.name}:\n${message.text}`);
                            //         console.log(`${message.sender.name}: ${message.text}`);
                            //     }
                            // } else {
                            //     chat.sendAction('mark_seen');
                            // }
                        }
                    }
                }
            },
            messageLimit: 0
        }).catch(error => {
            console.log("user.subscribeToRoom error:", error);
            convo.say(`ℹ️Tham gia phòng thất bại\nuser.subscribeToRoom_error`);
            convo.end();
        });
        convo.say(`ℹ️Tham gia phòng thành công!`);
        this.setRoomID(joinID, roomID);
    }
}