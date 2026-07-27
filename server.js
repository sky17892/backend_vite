import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === 'production';

// ==========================================
// [간단 토큰 파싱 유틸]
// `fake-jwt-token-${user.id}` 형식 토큰에서 userId를 꺼낸다.
// (진짜 JWT로 바꾸면 이 함수만 교체하면 됨)
// ==========================================
//

function getUserIdFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const token = auth.replace('Bearer ', '').trim();
  const match = token.match(/^fake-jwt-token-(\d+)$/);
  return match ? Number(match[1]) : null;
}

// 로그인 필수 라우트에 붙이는 미들웨어. DB에서 role까지 함께 조회해서 req에 심어둔다.
async function requireAuth(req, res, next) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({ error: '유효하지 않은 사용자입니다.' });
    }
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
}

// requireAuth 이후에 붙여서 admin만 통과시키는 미들웨어
function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
  }
  next();
}

async function startServer() {
  // 1. Express 앱 객체 생성 (반드시 최상단 위치!)
  const app = express();

  // 2. CORS 표준 미들웨어 설정 (중복 헤더 설정 제거)
    app.use(
    cors({
      origin: ['https://sky10024.dothome.co.kr'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  // 3. Body Parser 설정
  app.use(express.json());

  // ==========================================
  // [인증 API] /api/auth
  // ==========================================
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, nickname } = req.body;
      if (!email || !password || !nickname) {
        return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: '이미 존재하는 이메일입니다.' });
      }

      const user = await prisma.user.create({
        data: { email, password, nickname }, // role은 스키마 기본값 'user'로 자동 저장
      });

      const token = `fake-jwt-token-${user.id}`;
      res.json({
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || user.password !== password) {
        return res.status(400).json({ error: '이메일 또는 비밀번호가 일치하지 않습니다.' });
      }

      const token = `fake-jwt-token-${user.id}`;
      res.json({
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
  });

  // ==========================================
  // [게시글 API] /api/posts
  // category 컬럼으로 게시판을 구분 (자유/질문/후기 등)
  // ==========================================
  app.get('/api/posts', async (req, res) => {
    try {
      const { category, q } = req.query;
      const where = {};

      if (category) where.category = String(category);
      if (q) {
        where.OR = [
          { title: { contains: String(q) } },
          { body: { contains: String(q) } },
        ];
      }

      const posts = await prisma.post.findMany({
        where,
        include: { author: { select: { nickname: true } },
                  _count: { select: { comments: true } }, },
        orderBy: { createdAt: 'desc' },
      });
      res.json(posts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '게시글 목록을 불러오는 데 실패했습니다.' });
    }
  });

  app.get('/api/posts/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await prisma.post.findUnique({
        where: { id },
        include: {
          author: { select: { nickname: true } },
          comments: {
            include: { author: { select: { nickname: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!post) {
        return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
      }
      res.json(post);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '게시글 조회에 실패했습니다.' });
    }
  });

  // Post.authorId는 NOT NULL이므로 반드시 로그인 상태여야 작성 가능
  app.post('/api/posts', requireAuth, async (req, res) => {
    try {
      const { category, title, body } = req.body;
      if (!category || !title || !body) {
        return res.status(400).json({ error: '카테고리, 제목, 본문은 필수입니다.' });
      }

      const post = await prisma.post.create({
        data: {
          category,
          title,
          body,
          authorId: req.userId,
        },
        include: { author: { select: { nickname: true } } },
      });
      res.json(post);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '게시글 작성에 실패했습니다.' });
    }
  });

  // 작성자 본인 또는 admin만 삭제 가능
  app.delete('/api/posts/:id', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await prisma.post.findUnique({ where: { id } });

      if (!post) {
        return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
      }
      if (post.authorId !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({ error: '삭제 권한이 없습니다.' });
      }

      await prisma.post.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '게시글 삭제에 실패했습니다.' });
    }
  });

  // Comment.authorId는 NULL 허용이지만, 로그인된 유저라면 연결해준다
  app.post('/api/posts/:id/comments', async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
      }

      const authorId = getUserIdFromReq(req); // 비로그인이면 null로 저장됨

      const comment = await prisma.comment.create({
        data: { postId, content, authorId },
        include: { author: { select: { nickname: true } } },
      });
      res.json(comment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '댓글 등록에 실패했습니다.' });
    }
  });

  // ==========================================
  // [피해제보 API] /api/reports
  // Report 테이블엔 authorId 컬럼이 없으므로 제보 등록 자체는 익명 처리
  // 다만 상태(status) 변경은 admin만 가능
  // ==========================================
  app.get('/api/reports', async (req, res) => {
    try {
      const { status } = req.query;
      const where = status ? { status: String(status) } : {};

      const reports = await prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      res.json(reports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '피해제보 목록 조회 실패' });
    }
  });

  app.post('/api/reports', async (req, res) => {
    try {
      const { site, type, description } = req.body;
      if (!site || !type || !description) {
        return res.status(400).json({ error: '모든 입력 항목을 작성해주세요.' });
      }

      const report = await prisma.report.create({
        data: { site, type, description }, // status는 스키마 기본값 'pending'
      });
      res.json(report);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '피해제보 등록 실패' });
    }
  });

  // admin 전용: 피해제보 상태 변경 (pending / success / cancel)
  app.patch('/api/reports/:id/status', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;
      const ALLOWED_STATUS = ['pending', 'success', 'cancel'];

      if (!status || !ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({ error: '올바르지 않은 상태 값입니다.' });
      }

      const existing = await prisma.report.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });
      }

      const report = await prisma.report.update({
        where: { id },
        data: { status },
      });
      res.json(report);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: '상태 변경에 실패했습니다.' });
    }
  });

  // ==========================================
  // [서버 상태 확인 API] /api/health
  // ==========================================
  app.get('/api/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, dbAvailable: true });
    } catch (error) {
      res.json({ ok: true, dbAvailable: false });
    }
  });

  // ==========================================
  // [개발 / 프로덕션 분기 설정]
  // ==========================================
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));

    // Express v5 완벽 대응: 문자열 대신 정규식 객체 사용
    app.get(/(.*)/, (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT || 5173;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`서버 실행: http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});

// 종료 시 Prisma DB 커넥션 닫기
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});