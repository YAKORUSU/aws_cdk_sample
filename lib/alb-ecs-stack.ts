import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_ecs_patterns as ecs_patterns, aws_elasticloadbalancingv2 as elbv2, aws_logs as logs } from 'aws-cdk-lib';

interface AlbEcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  ecsTaskRole: cdk.aws_iam.Role;
  privateSubnets: ec2.ISubnet[];
}

export class AlbEcsStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: AlbEcsStackProps) {
    super(scope, id, props);

    const { vpc, albSecurityGroup, ecsSecurityGroup, ecsTaskRole } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    // Task Definition (taskRole はアプリが AWS リソースにアクセスする際の Role)
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: ecsTaskRole,
      executionRole: ecsTaskRole, // 実行ロールは必要に応じ別に作るべき。簡略化のため同一にしています。
    });

    // LogGroup
    const logGroup = new logs.LogGroup(this, 'ContainerLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('nginx:latest'), // 実運用は ECR を指定
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
      environment: {
        // 環境変数を必要に応じて追加
      },
    });
    container.addPortMappings({ containerPort: 80 });

    // Fargate Service
    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false,
      vpcSubnets: { subnets: props.privateSubnets },
    });
    this.ecsService = service;

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: [vpc.publicSubnets[0], vpc.publicSubnets[1]] },
    });

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'Not found' }),
    });

    // ターゲットグループを作成してサービスを登録
    const tg = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      targets: [service],
      healthCheck: {
        path: '/healthcheck',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });
    listener.addTargetGroups('AddTG', { targetGroups: [tg] });

    // AutoScaling - CPU によるスケール
    const scalable = service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scalable.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
  }
}
