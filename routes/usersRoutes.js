const router = require('express').Router();

const app = express()
app.use(cors())

router.get('/usuarios', controller.getUsers);
router.get('/usuarios/:id', controller.getUserById);
router.post('/usuarios', controller.createUser);
router.put('/usuarios/:id', controller.updateUser);
router.delete('/usuarios/:id', controller.deleteUser);