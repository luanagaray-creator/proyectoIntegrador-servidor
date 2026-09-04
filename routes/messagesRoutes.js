const router = require('express').Router();

const app = express()
app.use(cors())

router.get('/mensajes', controller.getMessages);
router.get('/mensajes/:id', controller.getMessageById);
router.post('/mensajes', controller.createMessage);
router.put('/mensajes/:id', controller.updateMessage);
router.delete('/mensajes/:id', controller.deleteMessage);