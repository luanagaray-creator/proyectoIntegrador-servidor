const router = require('express').Router();

const app = express()
app.use(cors())

router.get('/pagos', controller.getPaymentDetails);
router.get('/pagos/:id', controller.getPaymentDetailById);
router.post('/pagos', controller.createPaymentDetail);
router.put('/pagos/:id', controller.updatePaymentDetail);
router.delete('/pagos/:id', controller.deletePaymentDetail);