import { Router, type IRouter } from "express";
import healthRouter from "./health";
import memorizerRouter from "./memorizer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(memorizerRouter);

export default router;
