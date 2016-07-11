import Chats from '/imports/api/chat';
import Users from '/imports/api/users';
import Meetings from '/imports/api/meetings';

import Auth from '/imports/ui/services/auth';
import UnreadMessages from '/imports/ui/services/unread-messages';

import { callServer } from '/imports/ui/services/api';

const GROUPING_MESSAGES_WINDOW = 60000;

const SYSTEM_CHAT_TYPE = 'SYSTEM_MESSAGE';
const PUBLIC_CHAT_TYPE = 'PUBLIC_CHAT';
const PRIVATE_CHAT_TYPE = 'PRIVATE_CHAT';

const PUBLIC_CHAT_ID = 'public';
const PUBLIC_CHAT_USERID = 'public_chat_userid';
const PUBLIC_CHAT_USERNAME = 'public_chat_username';

const ScrollCollection = new Mongo.Collection(null);

/* TODO: Same map is done in the user-list/service we should share this someway */

const mapUser = (user) => ({
  id: user.userid,
  name: user.name,
  isPresenter: user.presenter,
  isModerator: user.role === 'MODERATOR',
  isCurrent: user.userid === Auth.userID,
  isVoiceUser: user.voiceUser.joined,
  isMuted: user.voiceUser.muted,
  isListenOnly: user.listenOnly,
  isSharingWebcam: user.webcam_stream.length,
  isLocked: user.locked,
});

const mapMessage = (messagePayload) => {
  const { message } = messagePayload;

  let mappedMessage = {
    id: messagePayload._id,
    content: messagePayload.content,
    time: message.from_time, //+ message.from_tz_offset,
    sender: null,
  };

  if (message.chat_type !== SYSTEM_CHAT_TYPE) {
    mappedMessage.sender = getUser(message.from_userid);
  }

  return mappedMessage;
};

const reduceMessages = (previous, current, index, array) => {
  let lastMessage = previous[previous.length - 1];
  let currentPayload = current.message;

  let unreadID = (currentPayload.chat_type == PUBLIC_CHAT_TYPE)
    ? PUBLIC_CHAT_ID : currentPayload.from_userid;

  current.content = [];
  current.content.push({
    id: currentPayload._id,
    text: currentPayload.message,
    time: currentPayload.from_time,
    unread: currentPayload.from_time > UnreadMessages.get(unreadID),
  });

  if (!lastMessage || !current.message.chat_type === SYSTEM_CHAT_TYPE) {
    return previous.concat(current);
  }

  let lastPayload = lastMessage.message;

  // Check if the last message is from the same user and time discrepancy
  // between the two messages exceeds window and then group current message
  // with the last one

  if (lastPayload.from_userid === currentPayload.from_userid
   && (currentPayload.from_time - lastPayload.from_time) <= GROUPING_MESSAGES_WINDOW) {
    lastMessage.content.push(current.content.pop());
    return previous;
  } else {
    return previous.concat(current);
  }
};

const getUser = (userID) => {
  const user = Users.findOne({ userId: userID });
  if (user) {
    return mapUser(user.user);
  } else {
    return null;
  }
};

const getPublicMessages = () => {
  let publicMessages = Chats.find({
    'message.chat_type': { $in: [PUBLIC_CHAT_TYPE, SYSTEM_CHAT_TYPE] },
  }, {
    sort: ['message.from_time'],
  })
  .fetch();

  return publicMessages.reduce(reduceMessages, []).map(mapMessage);
};

const getPrivateMessages = (userID) => {
  let messages = Chats.find({
    'message.chat_type': PRIVATE_CHAT_TYPE,
    $or: [
      { 'message.to_userid': userID },
      { 'message.from_userid': userID },
    ],
  }, {
    sort: ['message.from_time'],
  }).fetch();

  return messages.reduce(reduceMessages, []).map(mapMessage);
};

const isChatLocked = (receiverID) => {
  const isPublic = receiverID === PUBLIC_CHAT_ID;
  const currentUser = getUser(Auth.userID);
  const meeting = Meetings.findOne({});

  const lockSettings = meeting.roomLockSettings || {
    disablePublicChat: false,
    disablePrivateChat: false,
  };

  if (!currentUser.isLocked || currentUser.isPresenter) {
    return false;
  }

  return isPublic ? lockSettings.disablePublicChat : lockSettings.disablePrivateChat;
};

const hasUnreadMessages = (receiverID) => {
  const isPublic = receiverID === PUBLIC_CHAT_ID;
  receiverID = isPublic ? PUBLIC_CHAT_USERID : receiverID;

  return UnreadMessages.count(receiverID) > 0;
};

const sendMessage = (receiverID, message) => {
  const isPublic = receiverID === PUBLIC_CHAT_ID;

  const sender = getUser(Auth.userID);
  const receiver = !isPublic ? getUser(receiverID) : {
    id: PUBLIC_CHAT_USERID,
    name: PUBLIC_CHAT_USERNAME,
  };

  /* FIX: Why we need all this payload to send a message?
   * The server only really needs the message, from_userid, to_userid and from_lang
   */

  let messagePayload = {
    message: message,
    chat_type: isPublic ? PUBLIC_CHAT_TYPE : PRIVATE_CHAT_TYPE,
    from_userid: sender.id,
    from_username: sender.name,
    from_tz_offset: (new Date()).getTimezoneOffset(),
    to_username: receiver.name,
    to_userid: receiver.id,
    from_lang: window.navigator.userLanguage || window.navigator.language,
    from_time: Date.now(),
    from_color: 0,
  };

  callServer('sendChatMessagetoServer', messagePayload);

  return messagePayload;
};

const getScrollPosition = (receiverID) => {
  let scroll = ScrollCollection.findOne({ receiver: receiverID }) || { position: null };
  return scroll.position;
};

const updateScrollPosition =
  (receiverID, position) => ScrollCollection.upsert(
    { receiver: receiverID },
    { $set: { position: position } },
  );

const updateUnreadMessage = (receiverID, timestamp) => {
  const isPublic = receiverID === PUBLIC_CHAT_ID;
  receiverID = isPublic ? PUBLIC_CHAT_USERID : receiverID;
  return UnreadMessages.update(receiverID, timestamp);
};

export default {
  getPublicMessages,
  getPrivateMessages,
  getUser,
  getScrollPosition,
  hasUnreadMessages,
  isChatLocked,
  updateScrollPosition,
  updateUnreadMessage,
  sendMessage,
};
