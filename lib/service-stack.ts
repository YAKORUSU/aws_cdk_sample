import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_elasticloadbalancingv2 as elbv2, aws_logs as logs, aws_iam as iam } from 'aws-cdk-lib';

interface ServiceStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  privateSubnets: ec2.ISubnet[];
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  ecsTaskRole: iam.Role;
}

export class ServiceStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const { vpc, privateSubnets, albSecurityGroup, ecsSecurityGroup, ecsTaskRole } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    // Task Definition（タスクロールは props.ecsTaskRole）
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: ecsTaskRole,
      executionRole,
    });

    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('nginx:latest'), // 実運用は ECR を指定
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
      environment: {},
    });
    container.addPortMappings({ containerPort: 80 });

    // Fargate Service
    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnets: privateSubnets },
    });
    this.ecsService = service;

    // ALB (Public)
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'AppALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: [vpc.publicSubnets[0], vpc.publicSubnets[1]] },
    });

    const listener = this.alb.addListener('HttpListener', { port: 80, open: true });

    // Target Group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTG', {
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

    listener.addTargetGroups('AddTG', { targetGroups: [this.targetGroup] });

    // AutoScaling (CPU)
    const scalable = service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scalable.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Optional: scale based on Pending tasks (to help avoid backlog)
    scalable.scaleOnMetric('PendingTasksScaling', {
      metric: service.metric('PendingTaskCount', {
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      scalingSteps: [
        { upper: 0, change: 0 },
        { lower: 1, change: +1 },
      ],
      adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY, // autoscaling を参照
    });
  }
}
