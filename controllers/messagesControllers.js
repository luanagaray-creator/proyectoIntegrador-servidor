const data = require('../data/messagesData.js');

function getMessages(req, res) {
    res.json(data.messages)
}

function getMessageById(req, res) {
    const messageId = parseInt(req.params.id);
    const message = data.messages.find(m => m.id === messageId);
    if (message) {
        res.json(message);
    } else {
        res.status(404).json({ error: 'Mensaje no encontrado' });
    }
}

function createMessage(req, res) {
    const { id, contenido, Destinatario } = req.body;
    const newMessage = { id, contenido, Destinatario };
    data.messages.push(newMessage);
    res.status(201).json(newMessage);
}

function updateMessage(req, res) {
    const messageId = parseInt(req.params.id);
    const message = data.messages.find(m => m.id === messageId);
    if (message) {
        const { contenido, Destinatario } = req.body;  
        message.contenido = contenido || message.contenido;
        message.Destinatario = Destinatario || message.Destinatario;
        res.json(message);
    } else {
        res.status(404).json({ error: 'Mensaje no encontrado' });
    }
}

function deleteMessage(req, res) {
    const messageId = parseInt(req.params.id);
    const messageIndex = data.messages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
        const deletedMessage = data.messages.splice(messageIndex, 1);
        res.json(deletedMessage[0]);
    } else {
        res.status(404).json({ error: 'Mensaje no encontrado' });
    }
}

export { getMessages, getMessageById, createMessage, updateMessage, deleteMessage };
