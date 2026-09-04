const router = require('express').Router();

const app = express()
app.use(cors())


router.get('/subscripciones', controller.getSubscriptions);
router.get('/subscripciones/:id', controller.getSubscriptionById);
router.post('/subscripciones', controller.createSubscription);
router.put('/subscripciones/:id', controller.updateSubscription);
router.delete('/subscripciones/:id', controller.deleteSubscription);