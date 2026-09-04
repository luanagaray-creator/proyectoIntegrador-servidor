const router = require('express').Router();

const app = express()
app.use(cors())

router.get('/facturas', controller.getInvoices);
router.get('/facturas/:id', controller.getInvoiceById);
router.post('/facturas', controller.createInvoice);
router.put('/facturas/:id', controller.updateInvoice);
router.delete('/facturas/:id', controller.deleteInvoice);